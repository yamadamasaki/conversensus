/**
 * ATProto PDS のコレクション操作
 *
 * **step1 Phase 6 p6-5b で legacy snapshot コレクション (sheet/node/edge/layout/
 * branch/commit/merge) の口を撤去した** — これらを読み書きしていた `branchState.ts` /
 * `sync.ts` / `mapper.ts` が退役し、消費者がゼロになったため (設計 §3.8)。
 * PDS 上の既存レコードと lexicon json は放置する決定なので、レコード型 (`types.ts`)
 * と NSID はそのまま残る。
 *
 * 残っているのは:
 *   - `batches`: op-log の正典コレクション (Phase 4c 以降の唯一の同期単位)
 *   - `files`:   legacy file レコードの後始末 (ファイル削除時の `delete` のみ)
 */

import type { AtUri, FileId, Rkey } from '@conversensus/shared';
import { batchRkeyFileCursor, batchRkeyPrefix } from './batchRkey';
import { currentDid, getAgent } from './client';
import {
  listBatchFileIds,
  listByRkeyPrefix,
  type RecordPage,
  type RecordSummary,
} from './rangeFetch';
import { type BatchRecord, NSID, type RecordResult } from './types';

/** trunk を指す表示名。branch 一覧・UI の既定枝として使う */
export const TRUNK_PREFIX = 'trunk';

/**
 * `listRecords` の 1 ページの取得件数。**PDS の上限値そのもの** —
 * `limit=101` は 400 InvalidRequest になることを実機で確認済 (設計 §5.1 の観測④)。
 */
const PAGE_LIMIT = 100;

/**
 * `applyWrites` の 1 リクエストあたりの write 上限 (step1 Phase 7 p7-4)。
 * **PDS の上限値そのもの** — 201 件は `400 InvalidRequest "Too many writes. Max: 200"`
 * になることを実機で確認済 (設計 §5.4)。
 */
const APPLY_WRITES_MAX = 200;

// --- 汎用ヘルパー ---

async function putRecord(
  collection: string,
  rkey: Rkey,
  record: Record<string, unknown>,
): Promise<RecordResult> {
  const res = await getAgent().api.com.atproto.repo.putRecord({
    repo: currentDid(),
    collection,
    rkey,
    record,
  });
  return res.data;
}

async function getRecord(
  collection: string,
  rkey: Rkey,
): Promise<{ uri: AtUri; cid: string; value: unknown }> {
  const res = await getAgent().api.com.atproto.repo.getRecord({
    repo: currentDid(),
    collection,
    rkey,
  });
  return { ...res.data, cid: res.data.cid ?? '' };
}

/**
 * `listRecords` を 1 ページだけ叩く (step1 Phase 7 p7-2)。
 *
 * 全件取得と範囲取得の共通の土台。`reverse` を省くと **rkey 降順**、`true` で昇順になり、
 * `cursor` はそれぞれ `rkey < cursor` / `rkey > cursor` として比較される (設計 §1.3)。
 * **cursor に検証は無く rkey として直接比較される**ので、前回応答由来でない値を渡して
 * 任意の rkey 位置へ seek できる (p7-0 で実機確認済)。
 */
async function listRecordsPage(
  collection: string,
  params: { cursor?: string; reverse?: boolean; limit?: number } = {},
): Promise<RecordPage> {
  const res = await getAgent().api.com.atproto.repo.listRecords({
    repo: currentDid(),
    collection,
    limit: params.limit ?? PAGE_LIMIT,
    cursor: params.cursor,
    reverse: params.reverse,
  });
  return { records: res.data.records, cursor: res.data.cursor };
}

async function listRecords(collection: string): Promise<RecordSummary[]> {
  const all: RecordSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = await listRecordsPage(collection, { cursor });
    all.push(...page.records);
    cursor = page.cursor;
  } while (cursor);
  return all;
}

/**
 * 複数レコードを `applyWrites` で**まとめて新規作成する** (step1 Phase 7 p7-4)。
 *
 * `putRecord` を 1 件ずつ回すと**レコード 1 件 = repo commit 1 回**になり、
 * MST 更新・署名・firehose イベントの費用がそのまま件数分かかる。実測 (設計 §5.4) で
 * 200 件が **4084ms (20.4ms/件) → 209ms (1.0ms/件)** と約 20 倍の差が出た。
 * 局所 PDS で RTT がほぼ 0 の条件での差なので、これは往復回数ではなく **commit 回数**の差である。
 *
 * **`#create` はべき等ではない** — 既存 rkey へ create すると PDS は 500 を返し、
 * そのチャンクは**丸ごと巻き戻る** (原子性は実機で確認済, §5.4 の観測④)。したがって
 * **呼び出し側が「これらの rkey はまだ存在しない」ことを確かめる責務を負う**。
 * べき等な上書きが要る経路 (outbox の再送など) は `putRecord` を使い続けること。
 */
async function createRecords(
  collection: string,
  entries: readonly { rkey: Rkey; record: Record<string, unknown> }[],
): Promise<void> {
  for (let i = 0; i < entries.length; i += APPLY_WRITES_MAX) {
    await getAgent().api.com.atproto.repo.applyWrites({
      repo: currentDid(),
      writes: entries.slice(i, i + APPLY_WRITES_MAX).map((e) => ({
        $type: 'com.atproto.repo.applyWrites#create' as const,
        collection,
        rkey: e.rkey,
        value: e.record,
      })),
    });
  }
}

async function deleteRecord(collection: string, rkey: Rkey): Promise<void> {
  await getAgent().api.com.atproto.repo.deleteRecord({
    repo: currentDid(),
    collection,
    rkey,
  });
}

// --- File (legacy レコードの後始末のみ) ---

export const files = {
  delete(fileId: string) {
    return deleteRecord(NSID.file, fileId);
  },
};

// --- Batch (op-log, step1 Phase 4c) ---

export const batches = {
  /**
   * rkey は `batchRkey()` **だけ**が組み立てる (Phase 7 p7-1, 設計 §6.6)。
   * ここへ任意の文字列を直書きすると `listByFile` の走査から漏れる。
   */
  put(rkey: string, data: Omit<BatchRecord, '$type'>): Promise<RecordResult> {
    return putRecord(NSID.batch, rkey, { $type: NSID.batch, ...data });
  },
  /**
   * **まだ存在しない**レコードをまとめて作る (Phase 7 p7-4 の移行専用)。
   * rkey は `put` と同じく `batchRkey()` だけが組み立てる。既存 rkey が 1 件でも
   * 混ざるとそのチャンクが丸ごと失敗する (`createRecords` の注意書き)。
   */
  createMany(
    entries: readonly { rkey: string; data: Omit<BatchRecord, '$type'> }[],
  ) {
    return createRecords(
      NSID.batch,
      entries.map((e) => ({
        rkey: e.rkey,
        record: { $type: NSID.batch, ...e.data },
      })),
    );
  },
  get(rkey: string) {
    return getRecord(NSID.batch, rkey);
  },
  /**
   * repo 全体の batch レコード (Phase 4d-4) — **移行 (p7-4) 専用** (p7-5)。
   *
   * 通常経路 (受信・catch-up・発見) はすべて下の範囲取得へ移った。ここが残るのは
   * **旧 rkey のレコードを探せるのが全件走査だけ**だからである — `listByFile` /
   * `listFileIds` は `v1~` で始まる rkey しか走査しない (§3.1 の分離)。
   */
  listAllForMigration() {
    return listRecords(NSID.batch);
  },
  /**
   * 1 ファイル分の batch レコードだけを取得する (Phase 7 p7-2)。
   * rkey が `v1~<fileId>~…` なので prefix 範囲取得で済み、**repo 全体を読まない**。
   * 旧 rkey (hex UUID) のレコードは `v1~` より小さいので、この走査には現れない (§3.1)。
   */
  listByFile(fileId: FileId) {
    return listByRkeyPrefix(
      (params) => listRecordsPage(NSID.batch, params),
      batchRkeyPrefix(fileId),
      batchRkeyFileCursor(fileId),
    );
  },
  /**
   * remote に存在する fileId を列挙する (Phase 7 p7-3)。
   * 1 ファイル 1 リクエスト・各 1 レコードで、**batch 本体を落とさない** (§3.3)。
   */
  listFileIds() {
    return listBatchFileIds((params) => listRecordsPage(NSID.batch, params));
  },
  delete(rkey: string) {
    return deleteRecord(NSID.batch, rkey);
  },
};
