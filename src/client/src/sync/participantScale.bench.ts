/**
 * 参加者数 (n) の軸のベンチ (step3 Phase 0 S0-3, 投棄可)
 *
 * `projectFile.bench.ts` が測っているのは op 数 (m) の軸だけで、単一 actor の合成ログである。
 * step3-entry §3.1 は「n が効くのは畳み込みではなく**取得**の側」と見込んだ —
 * 参加者ごとに repo を読み、**既読位置 (cursor) を持たないので毎回全件読む**からである。
 * ここではその見込みを、vector clock を入れる前の基準値として測る。
 *
 * 1 回の受信サイクルのうち、n に比例する部分を通す:
 *
 * 1. **取得**: 参加者ごとに `pullRemoteForFile` (本物の `collections.ts` → `rangeFetch` →
 *    `AtpAgent`) で、そのファイルの batch を全件読む。PDS は `testing/fakePds.ts` を
 *    プロセス内で呼ぶので、**時間にネットワークの往復は含まれない**。要求回数と転送量を
 *    別に数え、往復の費用は `要求回数 × RTT` として見積もる
 * 2. **選別**: `collectParticipantBatches` (参加期間の判定)
 * 3. **畳み込み**: 自分の分と合わせた n × m 件を `projectFile`
 *
 * 名簿の読み出し (判断ログ) は数えていない。参加者あたり 1〜数回の要求で、m に依らない。
 *
 * 実行: `bun run src/client/src/sync/participantScale.bench.ts`
 * (プロダクトコードではない。CI にも載せない。)
 */

import {
  type Batch,
  type Did,
  type FileId,
  type GraphFile,
  graphFileToBatches,
  type NodeId,
  type Op,
  type Participation,
  projectFile,
  type SheetId,
} from '@conversensus/shared';
import { AtprotoSyncProvider } from '../atproto/atprotoSyncProvider';
import { batchToRecord } from '../atproto/batchMapper';
import { batchRkey } from '../atproto/batchRkey';
import { batches as batchCollection } from '../atproto/collections';
import { NSID } from '../atproto/types';
import { createFakePds } from '../testing/fakePds';
import { collectParticipantBatches } from './receiveParticipantBatches';

/** `atproto/client.ts` の既定の PDS と揃える (agent はここを叩く) */
const PDS_ORIGIN = 'http://localhost:2583';
/** 1 回の `applyWrites` に載せる件数 (本物の PDS の上限) */
const APPLY_WRITES_MAX = 200;
/** 往復の費用の見積もりに使う RTT (ミリ秒)。同一リージョンの PDS を想定した値 */
const ASSUMED_RTT_MS = 50;
const PARTICIPANT_COUNTS = [2, 5, 10, 20];
const BATCHES_PER_PARTICIPANT = [100, 500, 2000];
const ITERATIONS = 5;

const uuid = () => crypto.randomUUID();
const didOf = (i: number) =>
  `did:plc:bench${String(i).padStart(20, '0')}` as Did;

type World = {
  fileId: FileId;
  participants: Did[];
  /** 自分 (participants[0]) の手元にある分 = genesis と自分の編集 */
  own: Batch[];
  participation: Participation;
};

/**
 * n 人が同じシートにノードを足し続けたログを作り、自分以外の分を PDS に置く。
 * clock は参加者の間で交互に進める (同時に編んでいる形)
 */
async function buildWorld(
  pds: ReturnType<typeof createFakePds>,
  n: number,
  m: number,
): Promise<World> {
  const sheetId = uuid() as SheetId;
  const file: GraphFile = {
    id: uuid() as FileId,
    name: 'bench',
    sheets: [{ id: sheetId, name: 'Sheet 1', nodes: [], edges: [] }],
  };
  const genesis = graphFileToBatches(file);
  const startClock = Math.max(...genesis.map((b) => b.clock)) + 1;
  const participants = Array.from({ length: n }, (_, i) => didOf(i));

  const logs = participants.map((did, i) =>
    Array.from({ length: m }, (_, j): Batch => {
      const op: Op = {
        kind: 'node.add',
        target: uuid() as NodeId,
        content: `${i}-${j}`,
      };
      return {
        id: uuid(),
        actor: `${did}#bench`,
        clock: startClock + j * n + i,
        timestamp: Date.now(),
        sheetId,
        ops: [op],
      } as Batch;
    }),
  );

  // 自分以外の分を、各自の repo に書く (本物と同じ applyWrites の口で)
  for (let i = 1; i < n; i++) {
    const did = participants[i];
    const password = 'pw';
    pds.addAccount({ did, handle: `p${i}.bench`, password });
    const session = await pds.fetch(
      new Request(`${PDS_ORIGIN}/xrpc/com.atproto.server.createSession`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier: did, password }),
      }),
    );
    const { accessJwt } = (await session.json()) as { accessJwt: string };
    const log = logs[i];
    for (let k = 0; k < log.length; k += APPLY_WRITES_MAX) {
      const writes = log.slice(k, k + APPLY_WRITES_MAX).map((b) => ({
        $type: 'com.atproto.repo.applyWrites#create',
        collection: NSID.batch,
        rkey: batchRkey(file.id, b.clock, b.id),
        value: { $type: NSID.batch, ...batchToRecord(b, file.id) },
      }));
      await pds.fetch(
        new Request(`${PDS_ORIGIN}/xrpc/com.atproto.repo.applyWrites`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${accessJwt}`,
          },
          body: JSON.stringify({ repo: did, writes }),
        }),
      );
    }
  }

  // 全員が最初から参加している名簿 (期間の判定は clock 0 から開く)
  const history = new Map(
    participants.map((did) => [
      did,
      [
        {
          kind: 'accept' as const,
          clock: 0,
          timestamp: 0,
          by: participants[0],
        },
      ],
    ]),
  );
  const participation = {
    participating: new Set(participants),
    invited: new Map(),
    departed: new Map(),
    history,
    rejected: [],
  } as unknown as Participation;

  return {
    fileId: file.id,
    participants,
    own: [...genesis, ...logs[0]],
    participation,
  };
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * `fetch` の差し替えは**プロセスで 1 回だけ**にし、向き先の PDS を測定ごとに替える。
 * `AtpAgent` はプロセスに 1 つで、作られた時点の `fetch` を握り続けるので、
 * 測定ごとに `fetch` を差し替えると 2 回目以降は古い PDS に届く
 */
let currentPds = createFakePds(PDS_ORIGIN);
let requests = 0;
let bytes = 0;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const response = await currentPds.fetch(new Request(input, init));
  requests += 1;
  bytes += (await response.clone().arrayBuffer()).byteLength;
  return response;
}) as typeof fetch;

async function measure(n: number, m: number) {
  const pds = createFakePds(PDS_ORIGIN);
  currentPds = pds;
  {
    const world = await buildWorld(pds, n, m);
    const provider = new AtprotoSyncProvider({
      batches: batchCollection,
      uploadBlobs: async () => ({ uploaded: [], failed: [] }) as never,
    });
    const deps = {
      pullRemoteForFile: (fileId: FileId, repo: Did) =>
        provider.pullRemoteForFile(fileId, repo),
    };

    const pullSamples: number[] = [];
    const foldSamples: number[] = [];
    let perCycleRequests = 0;
    let perCycleBytes = 0;
    let received = 0;
    for (let i = 0; i < ITERATIONS; i++) {
      requests = 0;
      bytes = 0;
      const t0 = performance.now();
      const collected = await collectParticipantBatches(
        world.fileId,
        world.participation,
        world.participants[0],
        deps,
      );
      const t1 = performance.now();
      projectFile([...world.own, ...collected.batches], world.fileId);
      const t2 = performance.now();
      pullSamples.push(t1 - t0);
      foldSamples.push(t2 - t1);
      perCycleRequests = requests;
      perCycleBytes = bytes;
      received = collected.batches.length;
    }
    return {
      n,
      m,
      received,
      requests: perCycleRequests,
      kib: perCycleBytes / 1024,
      pullMs: median(pullSamples),
      foldMs: median(foldSamples),
      rttMs: perCycleRequests * ASSUMED_RTT_MS,
    };
  }
}

const rows = [];
for (const n of PARTICIPANT_COUNTS) {
  for (const m of BATCHES_PER_PARTICIPANT) {
    rows.push(await measure(n, m));
  }
}

console.log(
  `\n1 サイクル (自分以外の n-1 人から、それぞれ m 件を全件取得) の費用。RTT は ${ASSUMED_RTT_MS}ms と仮定\n`,
);
console.log(
  '|   n |    m | 受信件数 | 要求 |   転送 KiB | 取得+選別 ms | 畳み込み ms | 往復の見積り ms |',
);
console.log(
  '| --: | ---: | -------: | ---: | ---------: | -----------: | ----------: | --------------: |',
);
for (const r of rows) {
  console.log(
    `| ${String(r.n).padStart(3)} | ${String(r.m).padStart(4)} | ${String(r.received).padStart(8)} | ${String(r.requests).padStart(4)} | ${r.kib.toFixed(0).padStart(10)} | ${r.pullMs.toFixed(1).padStart(12)} | ${r.foldMs.toFixed(1).padStart(11)} | ${String(r.rttMs).padStart(15)} |`,
  );
}
