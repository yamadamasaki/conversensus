import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileId, GraphFile, SheetId } from '@conversensus/shared';
import { EventStore, IN_MEMORY } from './eventStore';
import { migrateFileToOplog, W3_SCHEMA_VERSION } from './migrateFileToOplog';
import { writeFile } from './storage';

const FILE = 'file-1' as FileId;

/** 1 ノードを持つ最小 snapshot を DATA_DIR に書く */
async function writeSnapshot(id: FileId, name = 'スナップ'): Promise<void> {
  const snapshot: GraphFile = {
    id,
    name,
    sheets: [
      { id: 'sheet-1' as SheetId, name: 'Sheet 1', nodes: [], edges: [] },
    ],
  };
  await writeFile(snapshot);
}

let tmpDir: string;
let store: EventStore;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'conversensus-migrate-test-'));
  process.env.DATA_DIR = tmpDir;
  store = new EventStore(IN_MEMORY);
});

afterEach(async () => {
  delete process.env.DATA_DIR;
  store.close();
  await rm(tmpDir, { recursive: true, force: true });
});

describe('migrateFileToOplog (W3d-1)', () => {
  it('marker 不在 + snapshot 有 → genesis を実行し marker を立てる', async () => {
    await writeSnapshot(FILE);
    expect(await migrateFileToOplog(store, FILE)).toBe(true);
    expect(store.getSchemaVersion(FILE)).toBe(W3_SCHEMA_VERSION);
    // genesis は最低でも file.setName batch を含む
    expect(store.getBatches(FILE).length).toBeGreaterThan(0);
  });

  it('snapshot 欠損なら migration せず (破棄しない) false を返す', async () => {
    // snapshot を書かない → 破棄の前提が無いので現状維持
    expect(await migrateFileToOplog(store, FILE)).toBe(false);
    expect(store.getSchemaVersion(FILE)).toBeNull();
    expect(store.getBatches(FILE)).toHaveLength(0);
  });

  it('二度目の呼び出しは no-op で false (再入べき等)', async () => {
    await writeSnapshot(FILE);
    expect(await migrateFileToOplog(store, FILE)).toBe(true);
    const first = store.getBatches(FILE).map((b) => b.id);
    // snapshot を変えても marker 済なので再 genesis されない
    await writeSnapshot(FILE, '変更後');
    expect(await migrateFileToOplog(store, FILE)).toBe(false);
    expect(store.getBatches(FILE).map((b) => b.id)).toEqual(first);
  });

  it('pre-W3 の増分ログを破棄してから snapshot 由来の genesis に置き換える', async () => {
    // W2 以降の増分ログを模した batch を先に積む
    store.appendBatch(FILE, {
      id: 'increment' as never,
      actor: 'local',
      clock: 99,
      timestamp: 99,
      ops: [{ kind: 'node.add', target: 'stale' as never, content: '旧増分' }],
    });
    await writeSnapshot(FILE);
    await migrateFileToOplog(store, FILE);
    // 旧増分は消え、genesis だけが残る
    expect(store.getBatches(FILE).some((b) => b.id === 'increment')).toBe(
      false,
    );
    expect(store.getBatches(FILE).length).toBeGreaterThan(0);
  });
});
