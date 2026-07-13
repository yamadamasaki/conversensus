import {
  type Batch,
  BatchSchema,
  CONVERSENSUS_FILE_VERSION,
  type ConversensusFile,
  type FileId,
  type GraphFile,
  type GraphFileListItem,
  GraphFileListItemSchema,
  GraphFileSchema,
  type Lamport,
} from '@conversensus/shared';
import { z } from 'zod';

const BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000';

export async function fetchFiles(): Promise<GraphFileListItem[]> {
  const res = await fetch(`${BASE}/files`);
  if (!res.ok) throw new Error('Failed to fetch files');
  return z.array(GraphFileListItemSchema).parse(await res.json());
}

export async function fetchFile(id: string): Promise<GraphFile> {
  const res = await fetch(`${BASE}/files/${id}`);
  if (!res.ok) throw new Error('Failed to fetch file');
  return GraphFileSchema.parse(await res.json());
}

export async function createFile(name: string): Promise<GraphFile> {
  const res = await fetch(`${BASE}/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error('Failed to create file');
  return GraphFileSchema.parse(await res.json());
}

export async function saveFile(file: GraphFile): Promise<GraphFile> {
  const res = await fetch(`${BASE}/files/${file.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(file),
  });
  if (!res.ok) throw new Error('Failed to save file');
  return GraphFileSchema.parse(await res.json());
}

export async function removeFile(id: string): Promise<void> {
  const res = await fetch(`${BASE}/files/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete file');
}

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
