import { describe, expect, test } from 'bun:test';
import {
  type EdgeId,
  EdgeIdSchema,
  type NodeId,
  NodeIdSchema,
  type SheetId,
  SheetIdSchema,
} from '../schemas';
import { projectBatches, toSheet } from './project';
import { type Batch, BatchIdSchema, type Op } from './unified';

const nid = (): NodeId => NodeIdSchema.parse(crypto.randomUUID());
const eid = (): EdgeId => EdgeIdSchema.parse(crypto.randomUUID());

function batch(clock: number, ops: Op[], timestamp = clock): Batch {
  return {
    id: BatchIdSchema.parse(crypto.randomUUID()),
    actor: 'local',
    clock,
    timestamp,
    ops,
  };
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
