/**
 * PDS 上の op-log batch レコードを直接検査する (step1 W3d5-7)
 *
 * 設計 `deepse/plans/step1-w3d5-remote.md` §4.1 (critic A3) の受入基準を機械判定する。
 * **画面に載ったかどうかでは remote 送信を検証できない** — legacy snapshot 経路が肩代わりして
 * 「載ったように見える」偽の確証が起きるため (critic A2)。PDS 上のレコードそのものを見る。
 *
 * 検査項目:
 *   1. genesis が載っている (4e-0) — genesis batch が remote に載っていること
 *   2. presentation 非搭載 (D7) — 全 op が isSyncable を通ること
 *   3. sheetId 往復            — content batch が sheetId を持つこと
 *   4. clock 単調・衝突なし     — clock の重複が無いこと
 *
 * **op-log v2 (step3 Phase 1) の rkey (`<fileId>~<actor>~<seq>`) に合わせてある** (#254)。
 * 読み解きと検査は `src/client/src/atproto/remoteBatchChecks.ts` にあり、受信経路 (`pullRemoteForFile`) と同じ基準で
 * レコードを分ける — rkey が v2 の形でないもの・本文が rkey と食い違うもの・受け取れない値は
 * 検査対象から外し、件数を表示する (黙って捨てない)。
 *
 * device B (2 台目) 上で実行すれば、受入基準 3「別端末が remote から取得できる」の検証も兼ねる:
 *   listRecords で取得したレコードが `recordToRemoteBatch` を通って Batch に戻せることを、この
 *   スクリプト自体が確かめている (クライアントの pull と同じ mapper を使う)。
 *
 * 使い方:
 *   bun run scripts/inspect-remote-batches.ts
 *   PDS_URL=http://localhost:3000 REPO=alice.test bun run scripts/inspect-remote-batches.ts
 *   bun run scripts/inspect-remote-batches.ts --dump   # 全 batch を一覧表示
 *
 * listRecords は認証不要 (public) なのでログインは要らない。
 */

import {
  checkClockUnique,
  checkGenesisPresent,
  checkNoPresentation,
  checkSheetIdRoundTrip,
  classifyRecords,
  type ListedRecord,
} from '../src/client/src/atproto/remoteBatchChecks';
import { NSID } from '../src/client/src/atproto/types';

const DEFAULT_PDS_URL = 'http://localhost:3000';
const DEFAULT_REPO = 'alice.test';
/** listRecords の 1 ページあたり取得件数 (PDS 上限は 100) */
const PAGE_LIMIT = 100;

const PDS_URL = process.env.PDS_URL ?? DEFAULT_PDS_URL;
const REPO = process.env.REPO ?? DEFAULT_REPO;
const DUMP = process.argv.includes('--dump');

/** cursor をたどって batch コレクションの全レコードを取得する */
async function listAllRecords(): Promise<ListedRecord[]> {
  const all: ListedRecord[] = [];
  let cursor: string | undefined;
  do {
    const url = new URL('/xrpc/com.atproto.repo.listRecords', PDS_URL);
    url.searchParams.set('repo', REPO);
    url.searchParams.set('collection', NSID.batch);
    url.searchParams.set('limit', String(PAGE_LIMIT));
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `listRecords failed: ${res.status} ${res.statusText} (${await res.text()})`,
      );
    }
    const body = (await res.json()) as {
      records: ListedRecord[];
      cursor?: string;
    };
    all.push(...body.records);
    cursor = body.cursor;
  } while (cursor);
  return all;
}

async function main(): Promise<void> {
  console.log(`PDS:        ${PDS_URL}`);
  console.log(`repo:       ${REPO}`);
  console.log(`collection: ${NSID.batch}\n`);

  const records = await listAllRecords();
  if (records.length === 0) {
    console.log(
      'レコードが 0 件。ログインして編集したか、SYNC_TO_REMOTE が有効かを確認すること。',
    );
    process.exit(1);
  }

  // クライアントの pull と同じ mapper を通す = 別端末が Batch に戻せることの確認 (受入基準 3)
  const { remoteBatches, foreign, invalid } = classifyRecords(records);
  const batches = remoteBatches.map((rb) => rb.batch);

  console.log(
    `レコード ${records.length} 件 → batch ${batches.length} 件に復元` +
      (foreign.length > 0
        ? ` (rkey が v2 の形でないもの ${foreign.length} 件は検査対象外)`
        : ''),
  );
  for (const { rkey, reason } of invalid) {
    console.log(`  読めないレコード: ${rkey} — ${reason}`);
  }
  if (batches.length === 0) {
    console.log('\n検査できる batch が 0 件。');
    process.exit(1);
  }

  if (DUMP) {
    console.log('\n--- batch 一覧 (clock 順) ---');
    for (const { fileId, batch: b } of remoteBatches) {
      console.log(
        `  clock=${String(b.clock).padStart(4)} actor=${b.actor} seq=${b.seq} ` +
          `fileId=${fileId} sheetId=${b.sheetId ?? '(なし)'} ` +
          `ops=[${b.ops.map((o) => o.kind).join(', ')}]`,
      );
    }
  }

  const checks = [
    checkGenesisPresent(remoteBatches),
    checkNoPresentation(batches),
    checkSheetIdRoundTrip(batches),
    checkClockUnique(remoteBatches),
  ];

  console.log('\n--- 受入基準 (§4.1) ---');
  for (const c of checks) {
    console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}\n        ${c.detail}`);
  }

  // 読めないレコードがあれば FAIL にする。受信経路はそれを読み飛ばすので、画面では気付けない
  const failed = [
    ...checks.filter((c) => !c.ok).map((c) => c.name),
    ...(invalid.length > 0 ? [`読めないレコード ${invalid.length} 件`] : []),
  ];
  console.log(
    failed.length === 0
      ? '\nすべて PASS'
      : `\n${failed.length} 件 FAIL: ${failed.join(', ')}`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('検査に失敗:', err instanceof Error ? err.message : err);
  process.exit(1);
});
