import { join } from 'node:path';
import type { GraphFile, GraphFileListItem } from '@conversensus/shared';

function dataDir() {
  return process.env.DATA_DIR ?? join(import.meta.dir, '../../../data');
}

function filePath(id: string) {
  return join(dataDir(), `${id}.json`);
}

export async function listFiles(): Promise<GraphFileListItem[]> {
  const glob = new Bun.Glob('*.json');
  const items: GraphFileListItem[] = [];
  for await (const name of glob.scan(dataDir())) {
    const file = Bun.file(join(dataDir(), name));
    const data: GraphFile = await file.json();
    items.push({ id: data.id, name: data.name, description: data.description });
  }
  return items;
}

export async function readFile(id: string): Promise<GraphFile | null> {
  const file = Bun.file(filePath(id));
  if (!(await file.exists())) return null;
  return file.json();
}

export async function writeFile(data: GraphFile): Promise<void> {
  await Bun.write(filePath(data.id), JSON.stringify(data, null, 2));
}

export async function deleteFile(id: string): Promise<boolean> {
  const path = filePath(id);
  const file = Bun.file(path);
  if (!(await file.exists())) return false;
  const { unlink } = await import('node:fs/promises');
  await unlink(path);
  return true;
}
