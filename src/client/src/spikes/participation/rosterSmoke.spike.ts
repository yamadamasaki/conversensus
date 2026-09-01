/**
 * 名簿の読み出しの実機確認 (step2 Phase 1, 投棄前提)
 *
 * alice の repo に genesis + invite(bob) を、bob の repo に accept を置き、
 * **1 パスの不動点計算で両方が参加者として畳めるか**を確かめる。
 *
 * 単体テストは `fetchJudgments` を注入して閉じているので、確かめられていないのは
 * 「実 PDS に置いた判断が、別 repo をまたいで同じ名簿に畳めるか」である。
 *
 * 実行: bun run src/client/src/spikes/participation/rosterSmoke.spike.ts
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
import { readRoster } from '../../sync/readRoster';

const PDS = 'http://localhost:2583';
const PASSWORD = 'devpassword123';
const NSID = 'app.conversensus.graph.judgment';
const FILE = '9f000000-0000-4000-8000-0000000c0de1' as FileId;

let seq = 0;
const jb = (did: string, clock: number, ops: JudgmentOp[]): JudgmentBatch => ({
  id: `9f000000-0000-4000-8000-${String(++seq).padStart(12, '0')}` as BatchId,
  actor: `${did}#dev-1`,
  clock,
  timestamp: 0,
  ops,
});

async function login(handle: string) {
  const agent = new AtpAgent({ service: PDS });
  await agent.login({ identifier: handle, password: PASSWORD });
  return agent;
}

async function put(agent: AtpAgent, batch: JudgmentBatch): Promise<string> {
  const rkey = batchRkey(FILE, batch.clock, batch.id);
  await agent.api.com.atproto.repo.putRecord({
    repo: agent.session?.did ?? '',
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
  return rkey;
}

const results: { n: string; ok: boolean; note: string }[] = [];
const check = (n: string, ok: boolean, note = '') =>
  results.push({ n, ok, note });

async function main() {
  const alice = await login('alice.test');
  const bob = await login('bob.test');
  const aliceDid = (alice.session?.did ?? '') as Did;
  const bobDid = (bob.session?.did ?? '') as Did;
  console.log(`alice=${aliceDid}\nbob=${bobDid}\n`);

  // alice: 起点 + bob への招待 / bob: 承認。**op は書いた本人の repo にしかない**
  const written: Array<[AtpAgent, string]> = [];
  written.push([
    alice,
    await put(alice, jb(aliceDid, 0, [{ kind: 'participation.genesis' }])),
  ]);
  written.push([
    alice,
    await put(
      alice,
      jb(aliceDid, 1, [{ kind: 'participation.invite', target: bobDid }]),
    ),
  ]);
  written.push([
    bob,
    await put(
      bob,
      jb(bobDid, 2, [{ kind: 'participation.accept', inviter: aliceDid }]),
    ),
  ]);

  /** bob のセッションで、指定 repo の判断ログを読む */
  const fetchJudgments = async (_fileId: FileId, repo: Did) => {
    const res = await bob.api.com.atproto.repo.listRecords({
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
  };

  const deps = {
    fetchJudgments,
    buildLocalDidPredicate: async () => (did: Did) =>
      did === aliceDid || did === bobDid,
  };

  // ① 起点だけ (passes: 0) — 承認は bob の repo にあるので見えない
  const seedOnly = await readRoster(deps, {
    fileId: FILE,
    seed: aliceDid,
    passes: 0,
  });
  check(
    '① 起点だけでは bob は invited のまま (承認は bob の repo にある)',
    [...seedOnly.participation.participating].join() === aliceDid &&
      seedOnly.participation.invited.get(bobDid) === aliceDid,
    `participating=${[...seedOnly.participation.participating].length}, invited=${seedOnly.participation.invited.size}`,
  );

  // ② 1 パス広げる — bob の repo を読んで承認が見える
  const onePass = await readRoster(deps, { fileId: FILE, seed: aliceDid });
  check(
    '② 1 パスで両者が参加者になる',
    onePass.participation.participating.has(aliceDid) &&
      onePass.participation.participating.has(bobDid) &&
      onePass.participation.invited.size === 0,
    `読んだ repo: ${onePass.readRepos.length} 件`,
  );

  // ③ 被招待者は自分の側から起点を辿って、招待の実在を確かめられる
  check(
    '③ 捨てた op が無い (pre 条件をすべて満たしている)',
    onePass.participation.rejected.length === 0,
    `rejected=${onePass.participation.rejected.map((r) => r.reason).join() || 'なし'}`,
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
