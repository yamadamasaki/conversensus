import { describe, expect, it } from 'bun:test';
import type { Edge, Node } from '@xyflow/react';
import fc from 'fast-check';
import { contentOf, createChangeGate } from './changeGate';

/** 小さなプール。同じ id・同じ位置を引いて「中身が同じ」に当たるようにする */
const ID_POOL = ['n1', 'n2', 'n3'];
const COORD_POOL = [0, 10, 20];

const arbNode: fc.Arbitrary<Node> = fc.record({
  id: fc.constantFrom(...ID_POOL),
  position: fc.record({
    x: fc.constantFrom(...COORD_POOL),
    y: fc.constantFrom(...COORD_POOL),
  }),
  data: fc.record({ content: fc.constantFrom('', 'a', 'b') }),
});

const arbNodes = fc.uniqueArray(arbNode, {
  selector: (n) => n.id,
  maxLength: ID_POOL.length,
});

/** 中身を変えずに、React Flow が実際に変える見た目の値だけを変える */
const arbCosmetics = fc.record({
  measured: fc.record({
    width: fc.integer({ min: 1, max: 400 }),
    height: fc.integer({ min: 1, max: 400 }),
  }),
  selected: fc.boolean(),
  diffType: fc.constantFrom(undefined, 'add', 'update'),
});

function withCosmetics(
  node: Node,
  c: { measured: Node['measured']; selected: boolean; diffType?: string },
): Node {
  return {
    ...node,
    measured: c.measured,
    selected: c.selected,
    data: { ...node.data, diffType: c.diffType },
  };
}

function edge(id: string, source: string, target: string): Edge {
  return { id, source, target };
}

describe('changeGate: 中身が同じ変化は通さない', () => {
  it('あらゆる nodes について、計測・選択・差分の色だけが変わった canvas は通さない', () => {
    fc.assert(
      fc.property(arbNodes, fc.array(arbCosmetics), (nodes, cosmetics) => {
        const gate = createChangeGate();
        gate.seed(contentOf(nodes, []));
        const restyled = nodes.map((n, i) =>
          cosmetics[i] ? withCosmetics(n, cosmetics[i]) : n,
        );
        expect(gate.admit(contentOf(restyled, []))).toBe(false);
      }),
    );
  });

  it('あらゆる 2 つの nodes について、通すのは中身が違うときだけで、同じ変化は 2 度通さない', () => {
    fc.assert(
      fc.property(arbNodes, arbNodes, (before, after) => {
        const gate = createChangeGate();
        gate.seed(contentOf(before, []));
        const differs =
          JSON.stringify(contentOf(before, [])) !==
          JSON.stringify(contentOf(after, []));

        expect(gate.admit(contentOf(after, []))).toBe(differs);
        // 通した (または同じだった) 中身が新しい基準になる
        expect(gate.admit(contentOf(after, []))).toBe(false);
      }),
    );
  });
});

describe('changeGate: 例', () => {
  it('seed 直後に置いたノードは通す (時間では見分けない — step2 T7-7)', () => {
    const gate = createChangeGate();
    gate.seed(contentOf([], []));
    const placed = [{ id: 'n1', position: { x: 0, y: 0 }, data: {} }] as Node[];
    expect(gate.admit(contentOf(placed, []))).toBe(true);
  });

  it('ゴーストは保存対象ではないので、出入りしても通さない', () => {
    const gate = createChangeGate();
    gate.seed(contentOf([], []));
    const ghost = [
      { id: 'g', position: { x: 0, y: 0 }, data: { ghost: true } },
    ] as Node[];
    expect(gate.admit(contentOf(ghost, []))).toBe(false);
  });

  it('edge の差分の色 (style) は通さず、端点の変更は通す', () => {
    const gate = createChangeGate();
    gate.seed(contentOf([], [edge('e1', 'a', 'b')]));
    const colored = [
      { ...edge('e1', 'a', 'b'), style: { stroke: '#16a34a', strokeWidth: 3 } },
    ];
    expect(gate.admit(contentOf([], colored))).toBe(false);
    expect(gate.admit(contentOf([], [edge('e1', 'a', 'c')]))).toBe(true);
  });

  it('seed し直すと、その中身が新しい基準になる (受信の再 seed)', () => {
    const gate = createChangeGate();
    const one = [{ id: 'n1', position: { x: 0, y: 0 }, data: {} }] as Node[];
    gate.seed(contentOf([], []));
    gate.seed(contentOf(one, []));
    expect(gate.admit(contentOf(one, []))).toBe(false);
  });
});
