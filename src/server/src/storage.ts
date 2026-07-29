/**
 * legacy snapshot (GraphFile の JSON) への読取アクセス層
 *
 * **Phase 6 p6-5a で書込 (`writeFile`) は消えた** — 新しい snapshot はもう作られない。
 * 残っているのは Phase 6 より前に作られた既存ファイルを op-log へ移行するための
 * 入力 (`listSnapshotIds` / `readFile`) と、その残骸の後始末 (`deleteFile`) だけである。
 *
 * **このファイルの寿命は移行 (`migrateAllToOplog` / `migrateFileToOplog`) と同じ**。
 * 設計 §3.1 のとおり移行コードは Phase 6 のリリースには載せ、移行済み環境で no-op に
 * なった次のリリースで両方まとめて削除する — ここで先に消すと、既存 snapshot を持つ
 * 環境が移行の機会を得られないまま `GET /files` (op-log 単独, p6-2) から
 * 消えてしまう (設計 §4.5)。
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GraphFile } from '@conversensus/shared';

const SNAPSHOT_EXT = '.json';

function dataDir() {
  return process.env.DATA_DIR ?? join(import.meta.dir, '../../../data');
}

// パストラバーサル対策: id に使用できる文字を制限し, dataDir 外へのパスを拒否する
function filePath(id: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid file ID');
  const dir = resolve(dataDir());
  const resolved = resolve(dir, `${id}${SNAPSHOT_EXT}`);
  if (!resolved.startsWith(`${dir}/`) && resolved !== dir)
    throw new Error('Path traversal detected');
  return resolved;
}

/**
 * snapshot ファイルの id 一覧を返す (**中身を読まない**)。
 *
 * 中身を読む一覧 (旧 `listFiles`) は `GET /files` が op-log 単独になった時点 (p6-2) で
 * 消費者を失ったので削除した。走査を名前だけで行うのは、一括移行 (Phase 6 p6-0) が
 * per-file で失敗を隔離するため — 壊れた 1 件に一覧全体を巻き添えにさせない。
 * 読み込みは `readFile` に任せる。
 */
export async function listSnapshotIds(): Promise<string[]> {
  if (!existsSync(dataDir())) return [];
  const glob = new Bun.Glob(`*${SNAPSHOT_EXT}`);
  const ids: string[] = [];
  for await (const name of glob.scan(dataDir())) {
    ids.push(name.slice(0, -SNAPSHOT_EXT.length));
  }
  return ids;
}

export async function readFile(id: string): Promise<GraphFile | null> {
  const file = Bun.file(filePath(id));
  if (!(await file.exists())) return null;
  return file.json() as Promise<GraphFile>;
}

export async function deleteFile(id: string): Promise<boolean> {
  const path = filePath(id);
  const file = Bun.file(path);
  if (!(await file.exists())) return false;
  const { unlink } = await import('node:fs/promises');
  await unlink(path);
  return true;
}
