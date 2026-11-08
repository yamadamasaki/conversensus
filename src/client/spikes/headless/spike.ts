/**
 * agent 段 2 H0 の spike: DOM の無い bun のプロセスで、FileSession と参加の部品が動くかを見る。
 *
 * 実行: `bun run src/client/spikes/headless/spike.ts` (リポジトリの根から)
 *
 * 偽の PDS の上で、alice が File を作って agent を招待し、agent が承認して受信する。
 * 製品のコードではない。壊れた所を計画 (`deepse/plans/agent-stage2-headless.md`) に書き出すためのもの。
 */

import {
  type Actor,
  type BatchId,
  CausalClock,
  type Did,
  EventStore,
  type FileId,
  type JudgmentBatch,
  LocalStore,
  type NodeId,
  projectFile,
} from '@conversensus/shared';
import { BunSqliteDriver } from '@conversensus/shared/src/store/bunSqliteDriver';

const ORIGIN = 'http://localhost:2583';
const step = (s: string) => console.log(`\n== ${s}`);

// --- 1. 素の bun に無いもの ---------------------------------------------------
step('素の bun の大域');
console.log({
  window: typeof (globalThis as { window?: unknown }).window,
  localStorage: typeof (globalThis as { localStorage?: unknown }).localStorage,
  BroadcastChannel: typeof globalThis.BroadcastChannel,
  WebSocket: typeof globalThis.WebSocket,
  document: typeof (globalThis as { document?: unknown }).document,
});

// localStorage の代わり (H1 で file に保存する Storage にする)
class MapStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
}
if (!(globalThis as { localStorage?: unknown }).localStorage) {
  (globalThis as { localStorage?: Storage }).localStorage = new MapStorage();
}

// --- 2. import (ここで落ちるなら、読み込み時に DOM を触っている) ---------------
step('client のモジュールを読み込む');
const { createFakePds } = await import('../../src/testing/fakePds');
const { setLocalBackend } = await import('../../src/api');
const { storeBackend } = await import('../../src/local/storeBackend');
const { login, logout, setAuthBackend } = await import(
  '../../src/atproto/client'
);
const { passwordAuth } = await import('../../src/atproto/passwordAuth');
const { batches } = await import('../../src/atproto/collections');
const { AtprotoSyncProvider } = await import(
  '../../src/atproto/atprotoSyncProvider'
);
const { RemoteSyncQueue } = await import('../../src/atproto/remoteSyncQueue');
const { loadRoster, putJudgment } = await import(
  '../../src/atproto/judgmentStore'
);
const { createRosterSource } = await import('../../src/sync/rosterSource');
const { ensureOwnGenesis } = await import('../../src/sync/ensureOwnGenesis');
const { FileSession, providerFor } = await import('../../src/sync/fileSession');
const { appendJudgment } = await import('../../src/sync/appendJudgment');
const { encodeParticipationCode, decodeParticipationCode } = await import(
  '../../src/sync/participationCode'
);
const { getDeviceId } = await import('../../src/sync/actor');
const { createPdsBlobUploader } = await import('../../src/images/imageBlob');
console.log('ok');

// --- 3. 偽の PDS ---------------------------------------------------------------
const pds = createFakePds(ORIGIN);
const ALICE = {
  did: 'did:plc:alice' as Did,
  handle: 'alice.test',
  password: 'pw',
};
const AGENT = {
  did: 'did:plc:agent' as Did,
  handle: 'agent.test',
  password: 'pw',
};
pds.addAccount(ALICE);
pds.addAccount(AGENT);
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (pds.handles(url)) return pds.fetch(request);
  console.warn('unhandled fetch', request.url);
  return new Response('unhandled', { status: 599 });
}) as typeof fetch;
setAuthBackend(passwordAuth(ORIGIN));

// --- 端末 1 つ分の組み立て (H1 の createHeadlessClient の原型) ----------------
type Device = Awaited<ReturnType<typeof device>>;
async function device(who: typeof ALICE) {
  await logout();
  localStorage.clear();
  const store = new LocalStore(new EventStore(new BunSqliteDriver(':memory:')));
  const backend = storeBackend(store);
  setLocalBackend(backend);
  const session = await login(who.handle, who.password);
  const actor = `${session.did}#${getDeviceId()}` as Actor;
  const remoteQueue = new RemoteSyncQueue({
    provider: new AtprotoSyncProvider({
      batches,
      uploadBlobs: createPdsBlobUploader(),
    }),
    did: session.did,
    isLocalOnly: () => false,
  });
  const roster = createRosterSource({
    loadRoster,
    ensureOwnGenesis: (fileId: FileId, known: readonly JudgmentBatch[]) =>
      ensureOwnGenesis(
        { fetchBatches: backend.fetchBatches, putJudgment, actor },
        fileId,
        known,
      ),
    viewer: session.did,
  });
  const clocks = new Map<FileId, CausalClock>();
  const clockOf = (fileId: FileId) => {
    let c = clocks.get(fileId);
    if (!c) {
      c = new CausalClock(actor);
      clocks.set(fileId, c);
    }
    return c;
  };
  const sessionOf = (fileId: FileId) =>
    new FileSession({
      fileId,
      provider: providerFor(fileId, remoteQueue),
      causal: clockOf(fileId),
      actor,
      remoteQueue,
      roster,
      appendReceived: backend.pushReceivedBatches,
      fetchLocal: backend.fetchBatches,
      pollIntervalMs: 60_000,
    });
  const judge = async (
    fileId: FileId,
    ops: Parameters<typeof appendJudgment>[2],
    known: readonly JudgmentBatch[],
  ) =>
    appendJudgment(
      {
        clockFor: async (f) => {
          const c = clockOf(f);
          c.restore(await backend.fetchBatches(f));
          return c;
        },
        actor,
        putJudgment,
        newBatchId: () => crypto.randomUUID() as BatchId,
      },
      fileId,
      ops,
      known,
    );
  return { store, backend, did: session.did, actor, sessionOf, judge };
}

const show = (d: Device, fileId: FileId) => {
  const file = projectFile(d.store.events.getBatches(fileId), fileId);
  for (const sheet of file.sheets)
    console.log(
      `  sheet ${sheet.name}:`,
      sheet.nodes.map((n) => n.content),
    );
};

// --- 4. alice: File を作り、書き、agent を招待する ----------------------------
step('alice: File を作る');
const alice = await device(ALICE);
const created = await alice.backend.createFile('spike の File');
const fileId = created.id as FileId;
const sheetId = created.sheets[0]?.id;
console.log('actor', alice.actor, 'file', fileId);
const aliceSession = alice.sessionOf(fileId);
aliceSession.record(
  {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    category: 'structure',
    type: 'NODE_ADDED',
    nodeId: crypto.randomUUID() as NodeId,
    data: { id: crypto.randomUUID() as NodeId, content: 'alice が書いた' },
  },
  sheetId,
);
await aliceSession.settled();
await aliceSession.syncNow();
console.log(
  'alice の repo の batch',
  pds.records(ALICE.did, 'app.conversensus.v2.batch').length,
);

step('alice: agent を招待する');
const aliceRoster = await loadRoster({
  fileId,
  seed: ALICE.did,
  passes: 'converge',
});
await alice.judge(
  fileId,
  [{ kind: 'participation.invite', target: AGENT.did }],
  aliceRoster.batches,
);
const code = encodeParticipationCode({
  fileId,
  inviter: ALICE.did,
  invitee: AGENT.did,
});
console.log('code', code);

// --- 5. agent: 承認して受信する -------------------------------------------------
step('agent: 承認する');
const agent = await device(AGENT);
const decoded = decodeParticipationCode(code);
if (!decoded.ok) throw new Error('decode');
const seen = await loadRoster({
  fileId,
  seed: decoded.payload.inviter,
  passes: 'converge',
});
console.log(
  '招待されている?',
  seen.participation.invited.get(AGENT.did) === ALICE.did,
);
await agent.judge(
  fileId,
  [{ kind: 'participation.accept', inviter: ALICE.did }],
  seen.batches,
);

step('agent: 受信する');
const agentSession = agent.sessionOf(fileId);
await agentSession.syncNow();
show(agent, fileId);

step('agent: 書く');
agentSession.record(
  {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    category: 'structure',
    type: 'NODE_ADDED',
    nodeId: crypto.randomUUID() as NodeId,
    data: { id: crypto.randomUUID() as NodeId, content: 'agent が書いた' },
  },
  sheetId,
);
await agentSession.settled();
await agentSession.syncNow();

step('alice: 受信する');
const alice2 = await device(ALICE); // 新しい端末として入り直す (同じプロセスに agent は 1 つ)
const alice2Session = alice2.sessionOf(fileId);
await alice2Session.syncNow();
show(alice2, fileId);

globalThis.fetch = realFetch;
step('終わり');
process.exit(0);
