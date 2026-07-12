import { describe, expect, test } from 'bun:test';
import {
  type EdgeId,
  EdgeIdSchema,
  type NodeId,
  NodeIdSchema,
} from '../schemas';
import { mergeBranches } from './merge';
import { projectBatches } from './project';
import { type Batch, BatchIdSchema, type Op } from './unified';

const nid = (): NodeId => NodeIdSchema.parse(crypto.randomUUID());
const eid = (): EdgeId => EdgeIdSchema.parse(crypto.randomUUID());

function batch(clock: number, ops: Op[], actor = 'local'): Batch {
  return {
    id: BatchIdSchema.parse(crypto.randomUUID()),
    actor,
    clock,
    timestamp: clock,
    ops,
  };
}

describe('mergeBranches', () => {
  test('content の並行変更を対立として検出し、LWW で暫定確定する', () => {
    const a = nid();
    // base: A を追加 (clock 1)
    // trunk: A を 'trunk' に (clock 2, alice)
    // branch: A を 'branch' に (clock 3, bob)
    const trunkAfterBase = [
      batch(
        2,
        [{ kind: 'node.setContent', target: a, content: 'trunk' }],
        'alice',
      ),
    ];
    const branchBatches = [
      batch(
        3,
        [{ kind: 'node.setContent', target: a, content: 'branch' }],
        'bob',
      ),
    ];
    const { merged, conflicts } = mergeBranches(trunkAfterBase, branchBatches);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].target).toBe(a);
    expect(conflicts[0].category).toBe('content');

    // base を含めて projection すると clock 最大の 'branch' が勝つ (LWW)
    const base = [batch(1, [{ kind: 'node.add', target: a, content: 'init' }])];
    const g = projectBatches([...base, ...merged]);
    expect(g.nodes.get(a)?.content).toBe('branch');
  });

  test('layout の並行変更は対立にしない (静かな LWW)', () => {
    const a = nid();
    const trunkAfterBase = [
      batch(2, [{ kind: 'node.setLayout', target: a, x: 10, y: 10 }]),
    ];
    const branchBatches = [
      batch(3, [{ kind: 'node.setLayout', target: a, x: 99, y: 99 }]),
    ];
    const { merged, conflicts } = mergeBranches(trunkAfterBase, branchBatches);

    expect(conflicts).toHaveLength(0); // layout は対立に含めない (D7)

    const base = [batch(1, [{ kind: 'node.add', target: a, content: 'A' }])];
    const g = projectBatches([...base, ...merged]);
    expect(g.nodeLayouts.get(a)).toMatchObject({ x: 99, y: 99 }); // clock 最大が勝つ
  });

  test('同じ値への並行変更は対立にしない', () => {
    const a = nid();
    const trunkAfterBase = [
      batch(2, [{ kind: 'node.setContent', target: a, content: 'same' }]),
    ];
    const branchBatches = [
      batch(3, [{ kind: 'node.setContent', target: a, content: 'same' }]),
    ];
    const { conflicts } = mergeBranches(trunkAfterBase, branchBatches);
    expect(conflicts).toHaveLength(0);
  });

  test('structure の新規追加はマージ後も保持される (OR-Set)', () => {
    const a = nid();
    const d = nid();
    const e = eid();
    const trunkAfterBase = [
      batch(2, [{ kind: 'node.add', target: a, content: 'A' }]),
    ];
    const branchBatches = [
      batch(3, [
        { kind: 'node.add', target: d, content: 'D' },
        { kind: 'edge.add', target: e, source: a, dest: d },
      ]),
    ];
    const { merged } = mergeBranches(trunkAfterBase, branchBatches);
    const g = projectBatches(merged);
    expect(g.nodes.has(a)).toBe(true);
    expect(g.nodes.has(d)).toBe(true);
    expect(g.edges.has(e)).toBe(true);
  });

  test('異なるノードへの content 変更は対立しない', () => {
    const a = nid();
    const b = nid();
    const trunkAfterBase = [
      batch(2, [{ kind: 'node.setContent', target: a, content: 'a2' }]),
    ];
    const branchBatches = [
      batch(3, [{ kind: 'node.setContent', target: b, content: 'b2' }]),
    ];
    const { conflicts } = mergeBranches(trunkAfterBase, branchBatches);
    expect(conflicts).toHaveLength(0);
  });
});
