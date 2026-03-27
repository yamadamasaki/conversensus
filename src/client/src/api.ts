import {
  CONVERSENSUS_FILE_VERSION,
  type ConversensusFile,
  type GraphFile,
  type GraphFileListItem,
  GraphFileListItemSchema,
  GraphFileSchema,
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
  a.download = `${file.name}.conversensus`;
  a.click();
  URL.revokeObjectURL(url);
}
