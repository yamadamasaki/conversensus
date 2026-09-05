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
 * ## 2 つの読み方がある
 *
 * **平ら読み (既定)**: `REPOS` に挙げた repo を全部読んで畳む。**誰の手元でもない名簿**が
 * 出る — 「全部見えていれば名簿はこうなる」の答えである。
 *
 * **起点読み (`SEED`)**: アプリと同じ不動点計算 (`readRoster`) で、**その actor から
 * 実際に見える名簿**を出す。アプリが読む repo は名簿が決め、その名簿は読んだ結果で決まる
 * ので、**平ら読みでは健全に見えるのに画面では壊れている**ことが起こる。
 *
 * 実際に起きた (2026-09-05)。alice が作った File で bob が alice を呼び戻したとき、
 * 平ら読みの名簿には依頼がちゃんと出るのに、alice の画面は「参加依頼が見つからない」
 * だった。alice は `seed=bob, passes=0` で読んでおり、**bob の repo には起点が無い**ので
 * 依頼が残らず捨てられていた。症状を再現できるのは起点読みだけである。
 *
 * 使い方:
 *   REPOS=alice.test,bob.test bun run scripts/inspect-judgments.ts
 *   REPOS=alice.test,bob.test FILE_ID=<uuid> bun run scripts/inspect-judgments.ts
 *   PDS_URL=http://localhost:2583 REPOS=... bun run scripts/inspect-judgments.ts --dump
 *
 *   # 起点読み: bob を起点に、広がりが止まるまで (参加コードを検めるときと同じ)
 *   SEED=bob.test FILE_ID=<uuid> bun run scripts/inspect-judgments.ts
 *   # 起点の repo だけ / 1 パスだけ (同期サイクルと同じ) も指定できる
 *   SEED=bob.test PASSES=0 FILE_ID=<uuid> bun run scripts/inspect-judgments.ts
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
import { readRoster } from '../src/client/src/sync/readRoster';
import {
  type BatchId,
  compareByClockActorId,
  type Did,
  didFromActor,
  type FileId,
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
/** 起点読みの起点。ハンドル名でも DID でもよい。省くと平ら読み */
const SEED = process.env.SEED;
/**
 * 起点の後に何回広げるか。既定は `converge` — **招待を検める経路と同じ**にする。
 * `0` は起点の repo だけ、`1` は同期サイクルと同じ。
 */
const PASSES = process.env.PASSES ?? 'converge';

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

/**
 * repo の判断ログを、どの File のものかを添えて読む。
 *
 * **fileId は batch には載っていない** — rkey が運ぶ属性なので、レコードを batch に
 * 直した時点で失われる。平ら読みも起点読みも File で絞るので、ここで組にして持つ。
 */
async function batchesOf(
  repo: string,
): Promise<{ fileId: string; batch: JudgmentBatch }[]> {
  const out: { fileId: string; batch: JudgmentBatch }[] = [];
  for (const record of await listAll(repo)) {
    const fileId = fileIdOf(record.uri);
    const batchId = batchIdFromRkey(record.uri.split('/').pop() ?? '');
    if (!fileId || !batchId || !isJudgmentRecordValue(record.value)) continue;
    const batch = recordToJudgmentBatch(batchId as BatchId, record.value);
    if (!batch) continue;
    out.push({ fileId, batch });
  }
  return out;
}

/**
 * 集めた判断ログを畳んで見せる。**平ら読みと起点読みで共通**である —
 * 違うのは「何を集めたか」だけで、そこから先の読み解き方は同じでなければならない
 */
function report(batches: JudgmentBatch[]) {
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
  console.log(
    `参加中: ${[...participation.participating].join(', ') || '(なし)'}`,
  );
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

/** ハンドル名なら DID に直す。`repo` 引数はどちらも受けるが、名簿の語彙は DID である */
async function toDid(handleOrDid: string): Promise<Did> {
  if (handleOrDid.startsWith('did:')) return handleOrDid as Did;
  const url = new URL('/xrpc/com.atproto.identity.resolveHandle', PDS_URL);
  url.searchParams.set('handle', handleOrDid);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`resolveHandle ${handleOrDid}: ${res.status}`);
  return ((await res.json()) as { did: Did }).did;
}

/**
 * 起点読み。**アプリと同じ `readRoster` を通す**ことがこのモードの全部である。
 *
 * 平ら読みは「全 repo が見えていれば名簿はこうなる」を出すが、アプリはそう読まない —
 * 読む repo は名簿が決め、その名簿は読んだ結果で決まる。**自前で歩き方を書き直すと、
 * 再現したかったズレをスクリプト側で作り直してしまう**ので、本物を呼ぶ。
 */
async function seedRead(fileId: string, seedName: string) {
  const seed = await toDid(seedName);
  const passes = PASSES === 'converge' ? 'converge' : Number(PASSES);
  if (passes !== 'converge' && !Number.isInteger(passes))
    throw new Error(`PASSES は整数か 'converge': ${PASSES}`);

  console.log(`起点:       ${seedName} (${seed})`);
  console.log(`広げ方:     passes=${PASSES}\n`);

  const cache = new Map<Did, { fileId: string; batch: JudgmentBatch }[]>();
  const collected = await readRoster(
    {
      fetchJudgments: async (_fileId, repo) => {
        if (!cache.has(repo)) cache.set(repo, await batchesOf(repo));
        return (cache.get(repo) ?? [])
          .filter((e) => e.fileId === fileId)
          .map((e) => e.batch);
      },
      // 他 PDS の判定はここでは行えないので、すべて自 PDS とみなす (平ら読みと同じ)
      buildLocalDidPredicate: async () => () => true,
    },
    { fileId: fileId as FileId, seed, passes },
  );

  console.log(`読んだ repo: ${collected.readRepos.join(', ') || '(なし)'}`);
  for (const u of collected.unreadable)
    console.log(`⚠️ 読めなかった repo: ${u.did} — ${u.error}`);

  // **読まなかった repo こそが起点読みの答えである。**判断ログに名前が出ているのに
  // 訪ねていない actor がいれば、その repo にある op はこの actor には見えていない
  const mentioned = new Set<Did>();
  for (const b of collected.batches) {
    mentioned.add(didFromActor(b.actor));
    for (const op of b.ops) {
      if ('target' in op) mentioned.add(op.target);
      if ('inviter' in op) mentioned.add(op.inviter);
    }
  }
  const unvisited = [...mentioned].filter(
    (d) => !collected.readRepos.includes(d),
  );
  if (unvisited.length > 0)
    console.log(
      `名前は出るが読んでいない repo: ${unvisited.join(', ')}\n` +
        '   → この actor の op はこの起点からは見えていない',
    );
  console.log();

  report(collected.batches);
}

async function main() {
  console.log(`PDS:        ${PDS_URL}`);
  // 起点読みは repo を自分で辿るので、`REPOS` は使わない。出すと嘘になる
  if (!SEED) console.log(`repos:      ${REPOS.join(', ')}`);
  console.log(`collection: ${NSID.judgment}\n`);

  // 起点読みで File が指定されていなければ、起点の repo にある File を出す。
  // **`REPOS` から出さない** — 起点が `REPOS` に含まれるとは限らない
  if (SEED && !FILE_ID) {
    const seed = await toDid(SEED);
    const files = new Set((await batchesOf(seed)).map((e) => e.fileId));
    console.log(`${SEED} (${seed}) の判断ログにある File:`);
    for (const fileId of [...files].sort()) console.log(`  ${fileId}`);
    console.log('\nFILE_ID=<uuid> を渡すとその起点から見える名簿を出す');
    return;
  }

  /** repo ごとの (fileId → 判断 batch) */
  const byRepo = new Map<string, Map<string, JudgmentBatch[]>>();
  for (const repo of REPOS) {
    const perFile = new Map<string, JudgmentBatch[]>();
    for (const { fileId, batch } of await batchesOf(repo))
      perFile.set(fileId, [...(perFile.get(fileId) ?? []), batch]);
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

  // --- 起点読み: アプリと同じ歩き方で、その actor から見える名簿を出す ---
  if (SEED) {
    await seedRead(FILE_ID, SEED);
    return;
  }

  // --- 平ら読み: 1 File 分を全 repo から集めて畳む ---
  const batches: JudgmentBatch[] = [];
  for (const repo of REPOS) {
    const mine = byRepo.get(repo)?.get(FILE_ID) ?? [];
    console.log(`${repo}: ${mine.length} 件`);
    batches.push(...mine);
  }
  console.log();

  report(batches);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
