import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, it } from 'bun:test';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  Batch,
  Commit,
  CommitId,
  FileId,
  NodeId,
  SheetId,
} from '@conversensus/shared';
import { EventStore, IN_MEMORY } from './eventStore';

const FILE = 'file-1' as FileId;
const SHEET_META = { id: 'sheet-1' as SheetId, name: 'Sheet 1' };

let store: EventStore;

beforeEach(() => {
  store = new EventStore(IN_MEMORY);
});

/** node.add 1 件だけの Batch を作るヘルパ */
const addNode = (
  id: string,
  node: string,
  content: string,
  clock: number,
  timestamp = clock,
): Batch => ({
  id: id as Batch['id'],
  actor: 'local',
  clock,
  timestamp,
  ops: [{ kind: 'node.add', target: node as NodeId, content }],
});

describe('EventStore', () => {
  describe('appendBatch / getBatches', () => {
    it('追記した Batch を読み返せる', () => {
      const batch = addNode('b1', 'n1', 'ノード1', 1);
      expect(store.appendBatch(FILE, batch)).toBe(true);
      expect(store.getBatches(FILE)).toEqual([batch]);
    });

    it('同一 batch_id の再追記はべき等 (false を返し重複しない)', () => {
      const batch = addNode('b1', 'n1', 'ノード1', 1);
      expect(store.appendBatch(FILE, batch)).toBe(true);
      expect(store.appendBatch(FILE, batch)).toBe(false);
      expect(store.getBatches(FILE)).toHaveLength(1);
    });

    it('file_id が異なれば同じ batch_id でも共存する', () => {
      const other = 'file-2' as FileId;
      store.appendBatch(FILE, addNode('b1', 'n1', 'A', 1));
      store.appendBatch(other, addNode('b1', 'n1', 'B', 1));
      expect(store.getBatches(FILE)).toHaveLength(1);
      expect(store.getBatches(other)).toHaveLength(1);
    });

    it('clock 昇順で返す (追記順が逆でも)', () => {
      store.appendBatch(FILE, addNode('b2', 'n2', 'B', 2));
      store.appendBatch(FILE, addNode('b1', 'n1', 'A', 1));
      expect(store.getBatches(FILE).map((b) => b.id)).toEqual(['b1', 'b2']);
    });

    it('壊れた Batch (ops 空) は追記を拒否する', () => {
      const broken = { ...addNode('b1', 'n1', 'A', 1), ops: [] } as Batch;
      expect(() => store.appendBatch(FILE, broken)).toThrow();
      expect(store.getBatches(FILE)).toHaveLength(0);
    });
  });

  describe('appendBatches', () => {
    it('複数 Batch を一括追記し、新規件数を返す', () => {
      const inserted = store.appendBatches(FILE, [
        addNode('b1', 'n1', 'A', 1),
        addNode('b2', 'n2', 'B', 2),
      ]);
      expect(inserted).toBe(2);
      expect(store.getBatches(FILE)).toHaveLength(2);
    });

    it('一部が重複していれば新規分のみカウントする', () => {
      store.appendBatch(FILE, addNode('b1', 'n1', 'A', 1));
      const inserted = store.appendBatches(FILE, [
        addNode('b1', 'n1', 'A', 1),
        addNode('b2', 'n2', 'B', 2),
      ]);
      expect(inserted).toBe(1);
      expect(store.getBatches(FILE)).toHaveLength(2);
    });
  });

  describe('sheetId の永続化 (W3c2)', () => {
    const SHEET = 'sheet-9' as SheetId;
    const addNodeInSheet = (
      id: string,
      node: string,
      content: string,
      clock: number,
      sheetId: SheetId,
    ): Batch => ({ ...addNode(id, node, content, clock), sheetId });

    it('content batch の sheetId を round-trip する', () => {
      store.appendBatch(FILE, addNodeInSheet('b1', 'n1', 'A', 1, SHEET));
      expect(store.getBatches(FILE)[0]?.sheetId).toBe(SHEET);
    });

    it('sheetId 無し (structure) batch は sheetId 無しで返る', () => {
      store.appendBatch(FILE, addNode('b1', 'n1', 'A', 1));
      expect(store.getBatches(FILE)[0]?.sheetId).toBeUndefined();
    });

    it('sheet_id 列が無い旧 DB を開くと ALTER で追加され sheetId を扱える (べき等)', () => {
      const path = join(
        tmpdir(),
        `evstore-w3c2-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
      );
      try {
        // W3c2 以前の旧スキーマ (sheet_id 列なし) を素の bun:sqlite で作る
        const legacy = new Database(path);
        legacy.run(
          `CREATE TABLE batches (
             seq INTEGER PRIMARY KEY AUTOINCREMENT,
             file_id TEXT NOT NULL, batch_id TEXT NOT NULL,
             actor TEXT NOT NULL, clock INTEGER NOT NULL,
             timestamp INTEGER NOT NULL, ops_json TEXT NOT NULL,
             UNIQUE(file_id, batch_id))`,
        );
        legacy
          .query(
            `INSERT INTO batches (file_id, batch_id, actor, clock, timestamp, ops_json)
             VALUES ($file, 'old', 'local', 1, 1, $ops)`,
          )
          .run({
            $file: FILE,
            $ops: JSON.stringify([
              { kind: 'node.add', target: 'n1', content: 'A' },
            ]),
          });
        legacy.close();

        // EventStore がマイグレーションを実行 → sheet_id 列が追加される
        const migrated = new EventStore(path);
        // 旧 batch は sheetId 無しで読める
        expect(migrated.getBatches(FILE)[0]?.sheetId).toBeUndefined();
        // 新規 content batch の sheetId を保存・読み戻せる
        migrated.appendBatch(FILE, addNodeInSheet('b2', 'n2', 'B', 2, SHEET));
        expect(
          migrated.getBatches(FILE).find((b) => b.id === 'b2')?.sheetId,
        ).toBe(SHEET);
        migrated.close();

        // 再オープン: マイグレーションは二度目でもべき等 (列は既存なので ALTER しない)
        const reopened = new EventStore(path);
        expect(reopened.getBatches(FILE)).toHaveLength(2);
        reopened.close();
      } finally {
        rmSync(path, { force: true });
        rmSync(`${path}-wal`, { force: true });
        rmSync(`${path}-shm`, { force: true });
      }
    });
  });

  describe('op-log 正典化 marker / migrateToOplog (W3d)', () => {
    const W3 = 1;

    it('marker 不在のファイルは getSchemaVersion が null', () => {
      expect(store.getSchemaVersion(FILE)).toBeNull();
    });

    it('migrateToOplog が genesis を append し marker を立てて true を返す', () => {
      const genesis = [
        addNode('g1', 'n1', 'A', 1),
        addNode('g2', 'n2', 'B', 2),
      ];
      expect(store.migrateToOplog(FILE, genesis, W3)).toBe(true);
      expect(store.getSchemaVersion(FILE)).toBe(W3);
      expect(store.getBatches(FILE).map((b) => b.id)).toEqual(['g1', 'g2']);
    });

    it('既存 (pre-W3) ログを破棄してから genesis で作り直す', () => {
      // migration 前に増分ログが存在する状態を作る
      store.appendBatch(FILE, addNode('old', 'n9', '旧', 5));
      const genesis = [addNode('g1', 'n1', 'A', 1)];
      store.migrateToOplog(FILE, genesis, W3);
      // 旧 batch は消え、genesis のみが残る (破棄→genesis)
      expect(store.getBatches(FILE).map((b) => b.id)).toEqual(['g1']);
    });

    it('marker 済のファイルへの再 migration は no-op で false を返す', () => {
      store.migrateToOplog(FILE, [addNode('g1', 'n1', 'A', 1)], W3);
      // 二度目は別の genesis を渡しても実行されない (marker ゲート)
      expect(
        store.migrateToOplog(FILE, [addNode('g2', 'n2', 'B', 2)], W3),
      ).toBe(false);
      // ログは初回 genesis のまま (再破棄・再 append されない)
      expect(store.getBatches(FILE).map((b) => b.id)).toEqual(['g1']);
    });

    it('marker はファイル境界で分離する', () => {
      const other = 'file-2' as FileId;
      store.migrateToOplog(FILE, [addNode('g1', 'n1', 'A', 1)], W3);
      expect(store.getSchemaVersion(FILE)).toBe(W3);
      expect(store.getSchemaVersion(other)).toBeNull();
    });
  });

  describe('projectSheet', () => {
    it('操作ログを projection して Sheet を導出する', () => {
      store.appendBatch(FILE, addNode('b1', 'n1', 'ノード1', 1));
      store.appendBatch(FILE, {
        id: 'b2' as Batch['id'],
        actor: 'local',
        clock: 2,
        timestamp: 2,
        ops: [
          { kind: 'node.setContent', target: 'n1' as NodeId, content: '改' },
        ],
      });
      const sheet = store.projectSheet(FILE, SHEET_META);
      expect(sheet.id).toBe(SHEET_META.id);
      expect(sheet.nodes).toHaveLength(1);
      // LWW: 後勝ちで content が更新されている
      expect(sheet.nodes[0]?.content).toBe('改');
    });

    it('空ログでは空の Sheet を返す', () => {
      const sheet = store.projectSheet(FILE, SHEET_META);
      expect(sheet.nodes).toEqual([]);
      expect(sheet.edges).toEqual([]);
    });
  });

  describe('saveCommit / getCommits', () => {
    const commit = (id: string, at: number): Commit => ({
      id: id as CommitId,
      message: `commit ${id}`,
      at,
      authorActor: 'local',
    });

    it('保存したコミットを at 昇順で読み返せる', () => {
      store.saveCommit(FILE, commit('c2', 5));
      store.saveCommit(FILE, commit('c1', 2));
      expect(store.getCommits(FILE).map((c) => c.id)).toEqual(['c1', 'c2']);
    });

    it('同一 id は上書きする', () => {
      store.saveCommit(FILE, commit('c1', 2));
      store.saveCommit(FILE, { ...commit('c1', 9), message: '更新' });
      const commits = store.getCommits(FILE);
      expect(commits).toHaveLength(1);
      expect(commits[0]?.at).toBe(9);
      expect(commits[0]?.message).toBe('更新');
    });

    it('ファイルが異なるコミットは混ざらない', () => {
      const other = 'file-2' as FileId;
      store.saveCommit(FILE, commit('c1', 2));
      store.saveCommit(other, commit('c2', 2));
      expect(store.getCommits(FILE).map((c) => c.id)).toEqual(['c1']);
      expect(store.getCommits(other).map((c) => c.id)).toEqual(['c2']);
    });
  });
});
