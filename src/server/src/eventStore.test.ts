import { beforeEach, describe, expect, it } from 'bun:test';
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
