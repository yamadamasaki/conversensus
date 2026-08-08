import {
  type Batch,
  BatchSchema,
  type BranchId,
  type BranchMeta,
  BranchMetaSchema,
  CONVERSENSUS_FILE_VERSION,
  type Commit,
  CommitSchema,
  type ConversensusFile,
  type FileId,
  FileIdSchema,
  type GraphFile,
  type GraphFileListItem,
  GraphFileListItemSchema,
  GraphFileSchema,
  type Lamport,
} from '@conversensus/shared';
import { z } from 'zod';

const BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000';
const HTTP_NOT_FOUND = 404;

export async function fetchFiles(): Promise<GraphFileListItem[]> {
  const res = await fetch(`${BASE}/files`);
  if (!res.ok) throw new Error('Failed to fetch files');
  return z.array(GraphFileListItemSchema).parse(await res.json());
}

/**
 * この端末が op-log を持つ file_id の全集合 (ANA-127)。
 *
 * `fetchFiles` と違い**削除済みも含む**。remote からの発見 (`discoverRemoteFiles`) の
 * 既知集合はこちらでなければならない — 一覧を使うと削除済みが「未知」に化けて
 * PDS から materialize され、削除が取り消される。
 */
export async function fetchLocalFileIds(): Promise<FileId[]> {
  const res = await fetch(`${BASE}/files/ids`);
  if (!res.ok) throw new Error('Failed to fetch local file ids');
  return z.array(FileIdSchema).parse(await res.json());
}

// `fetchFile` (GET /files/:id) と `saveFile` (PUT /files/:id) は Phase 6 p6-3 で
// 撤去した。ファイルの読取は op-log の projection (`fetchBatches` → `projectFile`)、
// 書込は batch の追記が唯一の口になった (設計 §3.4 / §3.6)。

export async function createFile(name: string): Promise<GraphFile> {
  const res = await fetch(`${BASE}/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error('Failed to create file');
  return GraphFileSchema.parse(await res.json());
}

// `removeFile` (DELETE /files/:id) は ANA-127 で撤去した。通常のファイル削除は
// op-log の tombstone (`sync/fileDeletion.ts`) になり、物理削除を呼ぶ経路が無くなった。
// サーバの endpoint 自体は「op-log ごと本当に消す」保守用として残してある (設計 D2) が、
// **クライアントからは呼ばない** — 呼ぶと tombstone まで消えて ANA-127 が再発する。
// 消費者のいないラッパーを残すと「書くが読まない二重モデル」になる (Phase 6 の教訓)。

export async function importFile(data: ConversensusFile): Promise<GraphFile> {
  const res = await fetch(`${BASE}/files/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to import file');
  return GraphFileSchema.parse(await res.json());
}

// --- 操作ログ (batches) --- (step1 Phase 4 実配線)

/** 操作ログへ batches を追記する。@returns 新規に追記された件数 */
export async function pushBatches(
  fileId: FileId,
  batches: Batch[],
): Promise<number> {
  const res = await fetch(`${BASE}/files/${fileId}/batches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(batches),
  });
  if (!res.ok) throw new Error('Failed to push batches');
  return z.object({ appended: z.number() }).parse(await res.json()).appended;
}

/**
 * **remote から受信した** batches を操作ログへ追記する (Phase 4d-5)。
 *
 * `pushBatches` とは別のエンドポイントを叩く。受信の書き込みは追記に加えて
 * op-log 正典 marker を立てる必要があり (設計 §3.3b)、marker が無いと次の読取で
 * lazy migration が受信内容を破棄する (§1.8)。取り違えないよう経路ごと分けている。
 *
 * @returns 新規に追記された件数 (既知の batch は server 側のべき等性で 0 件扱い)
 */
export async function pushReceivedBatches(
  fileId: FileId,
  batches: Batch[],
): Promise<number> {
  const res = await fetch(`${BASE}/files/${fileId}/batches/received`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(batches),
  });
  if (!res.ok) throw new Error('Failed to push received batches');
  return z.object({ appended: z.number() }).parse(await res.json()).appended;
}

/** 操作ログを取得する。since を渡すと clock > since のみ返す */
export async function fetchBatches(
  fileId: FileId,
  since?: Lamport,
): Promise<Batch[]> {
  const url =
    since === undefined
      ? `${BASE}/files/${fileId}/batches`
      : `${BASE}/files/${fileId}/batches?since=${since}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch batches');
  return z.array(BatchSchema).parse(await res.json());
}

// --- ブランチ / コミットのメタ情報 --- (step1 Phase 5)

/** コミット (ログ上のラベル付きオフセット) を保存する。同一 id は上書きされる */
export async function saveCommit(
  fileId: FileId,
  commit: Commit,
): Promise<Commit> {
  const res = await fetch(`${BASE}/files/${fileId}/commits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(commit),
  });
  if (!res.ok) throw new Error('Failed to save commit');
  return CommitSchema.parse(await res.json());
}

/** ファイルのコミット一覧を at 昇順で取得する */
export async function fetchCommits(fileId: FileId): Promise<Commit[]> {
  const res = await fetch(`${BASE}/files/${fileId}/commits`);
  if (!res.ok) throw new Error('Failed to fetch commits');
  return z.array(CommitSchema).parse(await res.json());
}

/** ブランチのメタ情報を保存する。分岐元 trunk (`meta.trunkFileId`) に紐付く */
export async function saveBranch(meta: BranchMeta): Promise<BranchMeta> {
  const res = await fetch(`${BASE}/files/${meta.trunkFileId}/branches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(meta),
  });
  if (!res.ok) throw new Error('Failed to save branch');
  return BranchMetaSchema.parse(await res.json());
}

/** trunk のブランチ一覧を base オフセット昇順で取得する */
export async function fetchBranches(
  trunkFileId: FileId,
): Promise<BranchMeta[]> {
  const res = await fetch(`${BASE}/files/${trunkFileId}/branches`);
  if (!res.ok) throw new Error('Failed to fetch branches');
  return z.array(BranchMetaSchema).parse(await res.json());
}

/**
 * ブランチを削除する。メタに加えて branch 専用 op-log / commit も消える (server 側 tx)。
 * 該当ブランチが無い場合も成功扱いにする — 「消えていること」が目的なので、
 * 二重削除や既に消えたブランチの削除を失敗として扱う理由が無い。
 */
export async function deleteBranch(
  trunkFileId: FileId,
  branchId: BranchId,
): Promise<void> {
  const res = await fetch(`${BASE}/files/${trunkFileId}/branches/${branchId}`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== HTTP_NOT_FOUND) {
    throw new Error('Failed to delete branch');
  }
}

export function exportFile(file: GraphFile): void {
  const data: ConversensusFile = {
    ...file,
    version: CONVERSENSUS_FILE_VERSION,
  };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeName = file.name.replace(/[/\\:*?"<>|]/g, '_');
  a.download = `${safeName}.conversensus`;
  a.click();
  URL.revokeObjectURL(url);
}
