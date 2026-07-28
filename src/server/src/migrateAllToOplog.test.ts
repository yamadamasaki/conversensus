import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileId, GraphFile, SheetId } from '@conversensus/shared';
import { EventStore, IN_MEMORY } from './eventStore';
import { migrateAllFilesToOplog } from './migrateAllToOplog';
import { W3_SCHEMA_VERSION } from './migrateFileToOplog';
import { writeFile } from './storage';

/** 1 シートを持つ最小 snapshot を DATA_DIR に書く */
async function writeSnapshot(id: FileId, name = 'スナップ'): Promise<void> {
  const snapshot: GraphFile = {
    id,
    name,
    sheets: [
      { id: `${id}-sheet` as SheetId, name: 'Sheet 1', nodes: [], edges: [] },
    ],
  };
  await writeFile(snapshot);
}

let tmpDir: string;
let store: EventStore;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'conversensus-migrate-all-test-'));
  process.env.DATA_DIR = tmpDir;
  store = new EventStore(IN_MEMORY);
});

afterEach(async () => {
  delete process.env.DATA_DIR;
  store.close();
  await rm(tmpDir, { recursive: true, force: true });
});

describe('migrateAllFilesToOplog (Phase 6 p6-0)', () => {
  it('未 migration の snapshot を全件 op-log 化する', async () => {
    const ids = ['file-a', 'file-b', 'file-c'] as FileId[];
    for (const id of ids) await writeSnapshot(id);

    const result = await migrateAllFilesToOplog(store);

    expect(result.scanned).toBe(ids.length);
    expect(result.migrated.toSorted()).toEqual(ids.toSorted());
    expect(result.skipped).toBe(0);
    expect(result.failed).toHaveLength(0);
    // 全ファイルが marker 済で genesis を持つ
    for (const id of ids) {
      expect(store.getSchemaVersion(id)).toBe(W3_SCHEMA_VERSION);
      expect(store.getBatches(id).length).toBeGreaterThan(0);
    }
  });

  it('2 回目の実行は no-op (べき等) — batch が増えも変わりもしない', async () => {
    const id = 'file-a' as FileId;
    await writeSnapshot(id);
    await migrateAllFilesToOplog(store);
    const first = store.getBatches(id).map((b) => b.id);

    // snapshot を書き換えても marker 済なので再 genesis されない
    await writeSnapshot(id, '変更後');
    const second = await migrateAllFilesToOplog(store);

    expect(second.migrated).toHaveLength(0);
    expect(second.skipped).toBe(1);
    expect(store.getBatches(id).map((b) => b.id)).toEqual(first);
  });

  it('壊れた snapshot が 1 件あっても残りは移行する (失敗を隔離する)', async () => {
    await writeSnapshot('healthy-a' as FileId);
    await writeSnapshot('healthy-b' as FileId);
    // JSON として読めないファイルを混ぜる (readFile の file.json() が throw する)
    await Bun.write(join(tmpDir, 'broken.json'), '{ これは JSON ではない');

    const result = await migrateAllFilesToOplog(store);

    expect(result.scanned).toBe(3);
    expect(result.migrated.toSorted()).toEqual([
      'healthy-a',
      'healthy-b',
    ] as FileId[]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.fileId).toBe('broken' as FileId);
    // 壊れた 1 件は marker が立たない = 次回起動で再試行される
    expect(store.getSchemaVersion('broken' as FileId)).toBeNull();
  });

  it('snapshot が 1 件も無くても正常終了する (初回起動)', async () => {
    const result = await migrateAllFilesToOplog(store);
    expect(result).toMatchObject({ scanned: 0, skipped: 0 });
    expect(result.migrated).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });

  it('DATA_DIR 自体が存在しなくても正常終了する', async () => {
    process.env.DATA_DIR = join(tmpDir, 'not-created-yet');
    const result = await migrateAllFilesToOplog(store);
    expect(result.scanned).toBe(0);
    expect(result.failed).toHaveLength(0);
  });

  it('snapshot を持たない op-log-only ファイル (受信 materialize) は触らない', async () => {
    // Phase 4e-2b で materialize されたファイルを模す: op-log にだけ存在する
    const received = 'received-only' as FileId;
    store.appendReceivedBatches(
      received,
      [
        {
          id: '00000001-0000-4000-8000-000000000000' as never,
          actor: 'did:plc:other#device',
          clock: 1,
          timestamp: 1,
          ops: [
            {
              kind: 'node.add',
              target: '00000002-0000-4000-8000-000000000000' as never,
              content: '他端末のノード',
            },
          ],
        },
      ],
      W3_SCHEMA_VERSION,
    );
    const before = store.getBatches(received).map((b) => b.id);

    const result = await migrateAllFilesToOplog(store);

    // 走査は snapshot 由来なので、そもそも対象に現れない
    expect(result.scanned).toBe(0);
    expect(store.getBatches(received).map((b) => b.id)).toEqual(before);
  });

  it('所要時間を返す (受入基準 §5-1 の実測に使う)', async () => {
    await writeSnapshot('file-a' as FileId);
    const result = await migrateAllFilesToOplog(store);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.elapsedMs)).toBe(true);
  });
});
