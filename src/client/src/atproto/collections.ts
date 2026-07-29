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

import type { AtUri, Rkey } from '@conversensus/shared';
import { currentDid, getAgent } from './client';
import { type BatchRecord, NSID, type RecordResult } from './types';

/** trunk を指す表示名。branch 一覧・UI の既定枝として使う */
export const TRUNK_PREFIX = 'trunk';

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

async function listRecords(
  collection: string,
): Promise<Array<{ uri: AtUri; cid: string; value: unknown }>> {
  const all: Array<{ uri: AtUri; cid: string; value: unknown }> = [];
  let cursor: string | undefined;
  do {
    const res = await getAgent().api.com.atproto.repo.listRecords({
      repo: currentDid(),
      collection,
      limit: 100,
      cursor,
    });
    all.push(...res.data.records);
    cursor = res.data.cursor;
  } while (cursor);
  return all;
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
  put(
    batchId: string,
    data: Omit<BatchRecord, '$type'>,
  ): Promise<RecordResult> {
    return putRecord(NSID.batch, batchId, { $type: NSID.batch, ...data });
  },
  get(batchId: string) {
    return getRecord(NSID.batch, batchId);
  },
  list() {
    return listRecords(NSID.batch);
  },
  delete(batchId: string) {
    return deleteRecord(NSID.batch, batchId);
  },
};
