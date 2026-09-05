/**
 * PDS 上の判断ログ (名簿) を直接検査する (step2 Phase 2)
 *
 * 名簿は**複数の repo に分かれて**いる — 「a が a' に依頼した」op は a の repo に、
 * 「a' が承認した」op は a' の repo にある。したがって「なぜ名簿がこうなるのか」は、
 * どれか 1 つの repo を見ても分からない。このスクリプトは**指定した repo すべてを
 * 読んで畳み込み**、結果と**捨てた op とその理由**を出す。
 *
 * 画面に出るのは畳み込みの結果だけなので、
 *
 *   - 依頼したのに相手が参加者にならない
 *   - 承認したのに File が現れない
 *
 * のような症状は、捨てられた op を見ないと説明できない (捨てられた依頼は行を持たない)。
 *
 * **起点 (`participation.genesis`) の重複を特に見る。**起点は File に 1 つで、2 つ目は
 * `duplicateGenesis` で捨てられる。捨てられた側の actor は参加者でなくなり、その actor が
 * 出した依頼も承認も pre 条件で落ちるので、**名簿が丸ごと壊れる**。しかも起点の clock は
 * 0 固定なので、後から書いても順序で覆せない。
 *
 * 使い方:
 *   REPOS=alice.test,bob.test bun run scripts/inspect-judgments.ts
 *   REPOS=alice.test,bob.test FILE_ID=<uuid> bun run scripts/inspect-judgments.ts
 *   PDS_URL=http://localhost:2583 REPOS=... bun run scripts/inspect-judgments.ts --dump
 *
 * `FILE_ID` を省くと、判断ログのある File を列挙して候補を出す。
 * listRecords は認証不要 (public) なのでログインは要らない。
 */

import {
  isJudgmentRecordValue,
  recordToJudgmentBatch,
} from '../src/client/src/atproto/judgmentMapper';
import { batchIdFromRkey } from '../src/client/src/atproto/batchRkey';
import { NSID } from '../src/client/src/atproto/types';
import {
  type BatchId,
  compareByClockActorId,
  didFromActor,
  foldParticipation,
  type JudgmentBatch,
} from '../src/shared/src/index';

const DEFAULT_PDS_URL = 'http://localhost:2583';
const PAGE_LIMIT = 100;

const PDS_URL = process.env.PDS_URL ?? DEFAULT_PDS_URL;
const REPOS = (process.env.REPOS ?? 'alice.test,bob.test')
  .split(',')
  .map((r) => r.trim())
  .filter(Boolean);
const FILE_ID = process.env.FILE_ID;
const DUMP = process.argv.includes('--dump');

type Record = { uri: string; cid: string; value: unknown };

async function listAll(repo: string): Promise<Record[]> {
  const all: Record[] = [];
  let cursor: string | undefined;
  do {
    const url = new URL('/xrpc/com.atproto.repo.listRecords', PDS_URL);
    url.searchParams.set('repo', repo);
    url.searchParams.set('collection', NSID.judgment);
    url.searchParams.set('limit', String(PAGE_LIMIT));
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`listRecords ${repo}: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { records: Record[]; cursor?: string };
    all.push(...body.records);
    cursor = body.cursor;
  } while (cursor);
  return all;
}

/** rkey は `v1~<fileId>~<clock>~<batchId>`。fileId は第 2 セグメント */
function fileIdOf(uri: string): string | null {
  const rkey = uri.split('/').pop() ?? '';
  const parts = rkey.split('~');
  return parts.length === 4 && parts[0] === 'v1' ? (parts[1] ?? null) : null;
}

async function main() {
  console.log(`PDS:        ${PDS_URL}`);
  console.log(`repos:      ${REPOS.join(', ')}`);
  console.log(`collection: ${NSID.judgment}\n`);

  /** repo ごとの (fileId → 判断 batch) */
  const byRepo = new Map<string, Map<string, JudgmentBatch[]>>();
  for (const repo of REPOS) {
    const perFile = new Map<string, JudgmentBatch[]>();
    for (const record of await listAll(repo)) {
      const fileId = fileIdOf(record.uri);
      const batchId = batchIdFromRkey(record.uri.split('/').pop() ?? '');
      if (!fileId || !batchId || !isJudgmentRecordValue(record.value)) continue;
      const batch = recordToJudgmentBatch(batchId as BatchId, record.value);
      if (!batch) continue;
      perFile.set(fileId, [...(perFile.get(fileId) ?? []), batch]);
    }
    byRepo.set(repo, perFile);
  }

  const files = new Set<string>();
  for (const perFile of byRepo.values())
    for (const fileId of perFile.keys()) files.add(fileId);

  if (!FILE_ID) {
    console.log('判断ログのある File:');
    for (const fileId of [...files].sort()) {
      const owners = REPOS.filter((r) => byRepo.get(r)?.has(fileId));
      console.log(`  ${fileId}  (${owners.join(', ')})`);
    }
    console.log('\nFILE_ID=<uuid> を渡すとその File の名簿を畳み込む');
    return;
  }

  // --- 1 File 分を全 repo から集めて畳む ---
  const batches: JudgmentBatch[] = [];
  for (const repo of REPOS) {
    const mine = byRepo.get(repo)?.get(FILE_ID) ?? [];
    console.log(`${repo}: ${mine.length} 件`);
    batches.push(...mine);
  }
  console.log();

  const ordered = [...batches].sort(compareByClockActorId);
  if (DUMP) {
    console.log('--- 判断 op (clock 順) ---');
    for (const b of ordered) {
      for (const op of b.ops) {
        const target = 'target' in op ? ` target=${op.target}` : '';
        const inviter = 'inviter' in op ? ` inviter=${op.inviter}` : '';
        console.log(
          `  clock=${String(b.clock).padStart(4)} ${didFromActor(b.actor)} ` +
            `${op.kind}${target}${inviter}`,
        );
      }
    }
    console.log();
  }

  // **起点の重複を先に見る。**2 つ目は捨てられ、捨てられた側の actor は参加者で
  // なくなるので、そこから依頼も承認も連鎖して落ちる
  const genesisOwners = ordered
    .filter((b) => b.ops.some((op) => op.kind === 'participation.genesis'))
    .map((b) => didFromActor(b.actor));
  if (genesisOwners.length > 1) {
    console.log(
      `⚠️ 起点が ${genesisOwners.length} つある: ${genesisOwners.join(', ')}`,
    );
    console.log(
      `   採択されるのは ${genesisOwners[0]} の分だけで, 残りは duplicateGenesis で` +
        '捨てられる。捨てられた側が出した依頼・承認も連鎖して落ちる\n',
    );
  } else if (genesisOwners.length === 0) {
    console.log('⚠️ 起点が無い。この File では依頼が 1 件残らず捨てられる\n');
  }

  // 他 PDS の判定はここでは行えないので、すべて自 PDS とみなして畳む
  const participation = foldParticipation(batches, { isLocalDid: () => true });
  console.log(`参加中: ${[...participation.participating].join(', ') || '(なし)'}`);
  console.log(
    `依頼中: ${[...participation.invited.keys()].join(', ') || '(なし)'}`,
  );
  console.log(
    `離脱中: ${[...participation.departed.keys()].join(', ') || '(なし)'}`,
  );

  if (participation.rejected.length > 0) {
    console.log(`\n捨てた op (${participation.rejected.length} 件):`);
    for (const r of participation.rejected) {
      console.log(
        `  clock=${String(r.clock).padStart(4)} ${didFromActor(r.actor)} ` +
          `${r.op.kind} — ${r.reason}`,
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
