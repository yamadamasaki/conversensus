/**
 * Phase 1 の完了基準を実 PDS で確かめる (投棄前提)
 *
 * 完了基準 (計画): **招待 → 承認で名簿に載り, 取消で外れる。取り消し合いを両方の端末で
 * 畳んで結論が一致する。**
 *
 * 単体テストは判断ログを注入して閉じているので, 確かめられていないのは
 * 「2 つの実 repo に散らばった判断が, どちらの手元でも同じ名簿に畳めるか」である。
 *
 * 実行: bun run src/client/src/spikes/participation/exitCriteria.spike.ts
 */

import { AtpAgent } from '@atproto/api';
import type {
  BatchId,
  Did,
  FileId,
  JudgmentBatch,
  JudgmentOp,
} from '@conversensus/shared';
import { batchRkey } from '../../atproto/batchRkey';
import { type ReadRosterDeps, readRoster } from '../../sync/readRoster';
import { rosterRows } from '../../sync/rosterView';

const PDS = 'http://localhost:2583';
const PASSWORD = 'devpassword123';
const NSID = 'app.conversensus.graph.judgment';
const FILE = '9f000000-0000-4000-8000-0000000e1717' as FileId;

let seq = 0;
const nextId = () =>
  `9f000000-0000-4000-8000-${String(++seq).padStart(12, '0')}` as BatchId;

async function login(handle: string) {
  const agent = new AtpAgent({ service: PDS });
  await agent.login({ identifier: handle, password: PASSWORD });
  return agent;
}

const written: Array<[AtpAgent, string]> = [];

async function write(
  agent: AtpAgent,
  did: Did,
  clock: number,
  ops: JudgmentOp[],
): Promise<void> {
  const batch: JudgmentBatch = {
    id: nextId(),
    actor: `${did}#dev-1`,
    clock,
    timestamp: 0,
    ops,
  };
  const rkey = batchRkey(FILE, batch.clock, batch.id);
  await agent.api.com.atproto.repo.putRecord({
    repo: did,
    collection: NSID,
    rkey,
    record: {
      $type: NSID,
      fileId: FILE,
      actor: batch.actor,
      clock: batch.clock,
      timestamp: batch.timestamp,
      ops: batch.ops,
      createdAt: new Date(0).toISOString(),
    },
  });
  written.push([agent, rkey]);
}

const results: { n: string; ok: boolean; note: string }[] = [];
const check = (n: string, ok: boolean, note = '') =>
  results.push({ n, ok, note });

async function main() {
  const alice = await login('alice.test');
  const bob = await login('bob.test');
  const A = (alice.session?.did ?? '') as Did;
  const B = (bob.session?.did ?? '') as Did;
  console.log(`alice=${A}\nbob=${B}\n`);

  /** その agent の手元で名簿を読む。**起点は自分自身** */
  const deps = (agent: AtpAgent): ReadRosterDeps => ({
    fetchJudgments: async (_fileId, repo) => {
      const res = await agent.api.com.atproto.repo.listRecords({
        repo,
        collection: NSID,
        limit: 100,
      });
      return res.data.records
        .filter((r) => (r.uri.split('/').pop() ?? '').startsWith(`v1~${FILE}~`))
        .map((r) => {
          const v = r.value as Record<string, unknown>;
          return {
            id: (r.uri.split('/').pop() ?? '').split('~')[3] as BatchId,
            actor: v.actor as string,
            clock: v.clock as number,
            timestamp: v.timestamp as number,
            ops: v.ops as JudgmentOp[],
          } satisfies JudgmentBatch;
        });
    },
    buildLocalDidPredicate: async () => (did: Did) => did === A || did === B,
  });

  const rosterOf = async (agent: AtpAgent, seed: Did) =>
    readRoster(deps(agent), { fileId: FILE, seed });

  // --- 招待 → 承認で名簿に載る ---
  await write(alice, A, 0, [{ kind: 'participation.genesis' }]);
  await write(alice, A, 1, [{ kind: 'participation.invite', target: B }]);

  const invited = await rosterOf(alice, A);
  const invitedRow = rosterRows(invited.participation, A).find(
    (r) => r.did === B,
  );
  check(
    '① 招待すると sent として一覧に出る',
    invitedRow?.status === 'sent' && invitedRow.inviter === A,
    `status=${invitedRow?.status}`,
  );

  await write(bob, B, 2, [{ kind: 'participation.accept', inviter: A }]);
  const accepted = await rosterOf(alice, A);
  check(
    '② 承認すると名簿に載る',
    accepted.participation.participating.has(B),
    `participating=${accepted.participation.participating.size}`,
  );

  // --- 両方の手元で結論が一致する ---
  const fromBob = await rosterOf(bob, B);
  check(
    '③ bob の手元でも同じ名簿になる',
    fromBob.participation.participating.has(A) &&
      fromBob.participation.participating.has(B),
    `bob 側 participating=${fromBob.participation.participating.size}`,
  );

  // --- 取り消しで外れる ---
  await write(alice, A, 3, [{ kind: 'participation.revoke', target: B }]);
  const revoked = await rosterOf(alice, A);
  const revokedRow = rosterRows(revoked.participation, A).find(
    (r) => r.did === B,
  );
  check(
    '④ 取り消すと名簿から外れ、revoked として残る',
    !revoked.participation.participating.has(B) &&
      revokedRow?.status === 'revoked',
    `status=${revokedRow?.status}`,
  );

  // --- 取り消し合い ---
  // bob は取り消されたことを知らずに alice を取り消す op を出す
  await write(bob, B, 4, [{ kind: 'participation.revoke', target: A }]);

  const aliceView = await rosterOf(alice, A);
  const bobView = await rosterOf(bob, B);
  // 仕様が求めるのは「取り消された側が取り消し返せない」ことであって、
  // 相手の repo を読みに行くことではない。取り消した後は相手を辿らなくなるので
  // (departed は広げる先に入らない)、bob の取り消しは alice の手元に届きさえしない。
  // 届いても pre 条件で捨てられるので、**どちらでも結論は同じ**である
  check(
    '⑤ 取り消し合いでも alice は名簿に残る',
    aliceView.participation.participating.has(A) &&
      !aliceView.participation.participating.has(B),
    `alice 側 participating=[${[...aliceView.participation.participating]}]`,
  );
  check(
    '⑥ 両方の手元で結論が一致する',
    [...aliceView.participation.participating].sort().join() ===
      [...bobView.participation.participating].sort().join(),
    `alice=[${[...aliceView.participation.participating]}] bob=[${[...bobView.participation.participating]}]`,
  );

  // 後始末
  for (const [agent, rkey] of written)
    await agent.api.com.atproto.repo.deleteRecord({
      repo: agent.session?.did ?? '',
      collection: NSID,
      rkey,
    });

  console.log('--- 判定 ---');
  for (const r of results)
    console.log(`${r.ok ? '✅' : '❌'} ${r.n}${r.note ? `  (${r.note})` : ''}`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) throw new Error(`${failed.length} 件の判定が落ちた`);
}

await main();
