import type { GraphFile, GraphFileListItem } from '@conversensus/shared';

const BASE = 'http://localhost:3000';

export async function fetchFiles(): Promise<GraphFileListItem[]> {
  const res = await fetch(`${BASE}/files`);
  if (!res.ok) throw new Error('Failed to fetch files');
  return res.json();
}

export async function fetchFile(id: string): Promise<GraphFile> {
  const res = await fetch(`${BASE}/files/${id}`);
  if (!res.ok) throw new Error('Failed to fetch file');
  return res.json();
}

export async function createFile(name: string): Promise<GraphFile> {
  const res = await fetch(`${BASE}/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error('Failed to create file');
  return res.json();
}

export async function saveFile(file: GraphFile): Promise<GraphFile> {
  const res = await fetch(`${BASE}/files/${file.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(file),
  });
  if (!res.ok) throw new Error('Failed to save file');
  return res.json();
}

export async function removeFile(id: string): Promise<void> {
  const res = await fetch(`${BASE}/files/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete file');
}
