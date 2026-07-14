import { describe, expect, test } from 'bun:test';
import {
  type EdgeId,
  EdgeIdSchema,
  type FileId,
  FileIdSchema,
  type NodeId,
  NodeIdSchema,
  type SheetId,
  SheetIdSchema,
} from '../schemas';
import { projectBatches, projectFile, toSheet } from './project';
import { type Batch, BatchIdSchema, type Op } from './unified';

const nid = (): NodeId => NodeIdSchema.parse(crypto.randomUUID());
const eid = (): EdgeId => EdgeIdSchema.parse(crypto.randomUUID());
const sid = (): SheetId => SheetIdSchema.parse(crypto.randomUUID());
const fid = (): FileId => FileIdSchema.parse(crypto.randomUUID());

function batch(clock: number, ops: Op[], timestamp = clock): Batch {
  return {
    id: BatchIdSchema.parse(crypto.randomUUID()),
    actor: 'local',
    clock,
    timestamp,
    ops,
  };
}

/** sheetId 付きの content batch (グラフ内容 op) */
function contentBatch(clock: number, sheetId: SheetId, ops: Op[]): Batch {
  return { ...batch(clock, ops), sheetId };
}

describe('projectBatches', () => {
  test('node.add / edge.add で状態を構築する', () => {
    const a = nid();
    const b = nid();
    const e = eid();
    const g = projectBatches([
      batch(1, [
        { kind: 'node.add', target: a, content: 'A' },
        { kind: 'node.add', target: b, content: 'B' },
        { kind: 'edge.add', target: e, source: a, dest: b },
      ]),
    ]);
    expect(g.nodes.get(a)?.content).toBe('A');
    expect(g.edges.get(e)).toMatchObject({ source: a, target: b });
  });

  test('content は clock 昇順の畳み込みで LWW になる (投入順に依存しない)', () => {
    const a = nid();
    const older = batch(1, [
      { kind: 'node.setContent', target: a, content: 'old' },
    ]);
    const newer = batch(2, [
      { kind: 'node.setContent', target: a, content: 'new' },
    ]);
    const seed = batch(0, [{ kind: 'node.add', target: a, content: 'init' }]);
    // 投入順を入れ替えても clock 順に解決される
    const g = projectBatches([newer, seed, older]);
    expect(g.nodes.get(a)?.content).toBe('new');
  });

  test('node.remove は接続エッジをカスケード削除する', () => {
    const a = nid();
    const b = nid();
    const e = eid();
    const g = projectBatches([
      batch(1, [
        { kind: 'node.add', target: a, content: 'A' },
        { kind: 'node.add', target: b, content: 'B' },
        { kind: 'edge.add', target: e, source: a, dest: b },
      ]),
      batch(2, [{ kind: 'node.remove', target: a }]),
    ]);
    expect(g.nodes.has(a)).toBe(false);
    expect(g.edges.has(e)).toBe(false);
  });

  test('node.setLayout は移動 (x/y) と リサイズ (width/height) を部分更新で合成する', () => {
    const a = nid();
    const g = projectBatches([
      batch(1, [{ kind: 'node.add', target: a, content: 'A' }]),
      batch(2, [{ kind: 'node.setLayout', target: a, x: 10, y: 20 }]),
      batch(3, [{ kind: 'node.setLayout', target: a, width: 100, height: 50 }]),
    ]);
    expect(g.nodeLayouts.get(a)).toMatchObject({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    });
  });

  test('presentation op は presentation マップに入り、意味的な状態に影響しない', () => {
    const e = eid();
    const a = nid();
    const b = nid();
    const g = projectBatches([
      batch(1, [
        { kind: 'node.add', target: a, content: 'A' },
        { kind: 'node.add', target: b, content: 'B' },
        { kind: 'edge.add', target: e, source: a, dest: b },
        { kind: 'edge.setStyle', target: e, style: { stroke: 'red' } },
      ]),
    ]);
    expect(g.presentation.get(e)).toEqual({ stroke: 'red' });
    expect(g.edges.get(e)?.properties).toBeUndefined();
  });

  test('toSheet は projection を Sheet 形式へ変換する', () => {
    const a = nid();
    const sheetId: SheetId = SheetIdSchema.parse(crypto.randomUUID());
    const g = projectBatches([
      batch(1, [
        { kind: 'node.add', target: a, content: 'A' },
        { kind: 'node.setLayout', target: a, x: 1, y: 2 },
      ]),
    ]);
    const sheet = toSheet(g, { id: sheetId, name: 'S' });
    expect(sheet.name).toBe('S');
    expect(sheet.nodes).toHaveLength(1);
    expect(sheet.layouts?.[0]).toMatchObject({ x: 1, y: 2 });
  });
});

describe('projectFile', () => {
  test('file メタ + sheet.create + content を GraphFile へ射影する', () => {
    const fileId = fid();
    const s1 = sid();
    const a = nid();
    const file = projectFile(
      [
        batch(1, [{ kind: 'file.setName', name: 'F' }]),
        batch(2, [{ kind: 'sheet.create', target: s1, name: 'S1' }]),
        contentBatch(3, s1, [{ kind: 'node.add', target: a, content: 'A' }]),
      ],
      fileId,
    );
    expect(file.id).toBe(fileId);
    expect(file.name).toBe('F');
    expect(file.sheets).toHaveLength(1);
    expect(file.sheets[0].name).toBe('S1');
    expect(file.sheets[0].nodes[0].content).toBe('A');
  });

  test('content は sheetId でグルーピングされる', () => {
    const s1 = sid();
    const s2 = sid();
    const a = nid();
    const b = nid();
    const file = projectFile(
      [
        batch(1, [{ kind: 'sheet.create', target: s1, name: 'S1' }]),
        batch(2, [{ kind: 'sheet.create', target: s2, name: 'S2' }]),
        contentBatch(3, s1, [{ kind: 'node.add', target: a, content: 'A' }]),
        contentBatch(4, s2, [{ kind: 'node.add', target: b, content: 'B' }]),
      ],
      fid(),
    );
    const sheet1 = file.sheets.find((s) => s.id === s1);
    const sheet2 = file.sheets.find((s) => s.id === s2);
    expect(sheet1?.nodes.map((n) => n.content)).toEqual(['A']);
    expect(sheet2?.nodes.map((n) => n.content)).toEqual(['B']);
  });

  test('sheet.remove でシートと content が射影から消える', () => {
    const s1 = sid();
    const a = nid();
    const file = projectFile(
      [
        batch(1, [{ kind: 'sheet.create', target: s1, name: 'S1' }]),
        contentBatch(2, s1, [{ kind: 'node.add', target: a, content: 'A' }]),
        batch(3, [{ kind: 'sheet.remove', target: s1 }]),
      ],
      fid(),
    );
    expect(file.sheets).toHaveLength(0);
  });

  test('sheet.reorder が順序を決め、order 外の live シートは createClock 昇順で末尾', () => {
    const s1 = sid();
    const s2 = sid();
    const s3 = sid();
    const file = projectFile(
      [
        batch(1, [{ kind: 'sheet.create', target: s1, name: 'S1' }]),
        batch(2, [{ kind: 'sheet.create', target: s2, name: 'S2' }]),
        batch(3, [{ kind: 'sheet.create', target: s3, name: 'S3' }]),
        // reorder は s3, s1 のみ指定 (s2 は order 外)
        batch(4, [{ kind: 'sheet.reorder', order: [s3, s1] }]),
      ],
      fid(),
    );
    // order 内 (s3, s1) の後に、order 外 live の s2 が createClock 昇順で追加
    expect(file.sheets.map((s) => s.id)).toEqual([s3, s1, s2]);
  });

  test('未作成シートの content batch は無視される (防御)', () => {
    const s1 = sid();
    const ghost = sid();
    const a = nid();
    const b = nid();
    const file = projectFile(
      [
        batch(1, [{ kind: 'sheet.create', target: s1, name: 'S1' }]),
        contentBatch(2, s1, [{ kind: 'node.add', target: a, content: 'A' }]),
        contentBatch(3, ghost, [{ kind: 'node.add', target: b, content: 'B' }]),
      ],
      fid(),
    );
    expect(file.sheets).toHaveLength(1);
    expect(file.sheets[0].nodes.map((n) => n.content)).toEqual(['A']);
  });

  test('sheet.setName / file.setDescription を LWW で反映する', () => {
    const s1 = sid();
    const file = projectFile(
      [
        batch(1, [{ kind: 'file.setName', name: 'F' }]),
        batch(2, [{ kind: 'sheet.create', target: s1, name: 'old' }]),
        batch(3, [{ kind: 'sheet.setName', target: s1, name: 'new' }]),
        batch(4, [{ kind: 'file.setDescription', description: 'desc' }]),
      ],
      fid(),
    );
    expect(file.description).toBe('desc');
    expect(file.sheets[0].name).toBe('new');
  });
});
