import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  type EdgeId,
  EdgeIdSchema,
  type NodeId,
  NodeIdSchema,
  type SheetId,
  SheetIdSchema,
} from '../schemas';
import {
  type CascadeGraphView,
  cascadeOfNodeRemoval,
  cascadeOfRemoval,
  isRemoveOp,
} from './cascade';
import { projectBatches } from './project';
import { type Batch, BatchIdSchema, type Op } from './unified';

const nid = (): NodeId => NodeIdSchema.parse(crypto.randomUUID());
const eid = (): EdgeId => EdgeIdSchema.parse(crypto.randomUUID());
const sid = (): SheetId => SheetIdSchema.parse(crypto.randomUUID());

function batch(clock: number, ops: Op[]): Batch {
  return {
    id: BatchIdSchema.parse(crypto.randomUUID()),
    actor: 'local',
    clock,
    timestamp: clock,
    ops,
  };
}

/** 素の (親子・端点だけの) グラフを組む。projection を通さず規則だけを見る用 */
function view(
  nodes: [NodeId, NodeId | undefined][],
  edges: [EdgeId, NodeId, NodeId][],
): CascadeGraphView {
  return {
    nodes: new Map(
      nodes.map(([id, parentId]) => [
        id,
        parentId === undefined ? {} : { parentId },
      ]),
    ),
    edges: new Map(
      edges.map(([id, source, target]) => [id, { source, target }]),
    ),
  };
}

const ids = (s: ReadonlySet<string>) => [...s].sort();

describe('cascadeOfNodeRemoval', () => {
  test('子を持たないノードは自分だけが消える', () => {
    const a = nid();
    const b = nid();
    const removed = cascadeOfNodeRemoval(
      view(
        [
          [a, undefined],
          [b, undefined],
        ],
        [],
      ),
      a,
    );
    expect(ids(removed.nodes)).toEqual([a]);
    expect(ids(removed.edges)).toEqual([]);
  });

  test('グループを消すと子孫もすべて消える (入れ子も辿る)', () => {
    // g > child > grandchild の 2 段。1 段しか辿らない実装だと grandchild が残る
    const g = nid();
    const child = nid();
    const grandchild = nid();
    const outside = nid();
    const removed = cascadeOfNodeRemoval(
      view(
        [
          [g, undefined],
          [child, g],
          [grandchild, child],
          [outside, undefined],
        ],
        [],
      ),
      g,
    );
    expect(ids(removed.nodes)).toEqual([g, child, grandchild].sort());
  });

  test('端点を失うエッジも消える (消える子に繋がるエッジを含む)', () => {
    // **この 1 件が Phase 3 T0 の主眼である。**削除された「op に書かれた id」は g
    // だけだが、実際に消えるのは child と、child に繋がる e2 でもある
    const g = nid();
    const child = nid();
    const outside = nid();
    const e1 = eid(); // g ↔ outside
    const e2 = eid(); // child ↔ outside
    const e3 = eid(); // outside ↔ outside (残る)
    const removed = cascadeOfNodeRemoval(
      view(
        [
          [g, undefined],
          [child, g],
          [outside, undefined],
        ],
        [
          [e1, g, outside],
          [e2, child, outside],
          [e3, outside, outside],
        ],
      ),
      g,
    );
    expect(ids(removed.nodes)).toEqual([g, child].sort());
    expect(ids(removed.edges)).toEqual([e1, e2].sort());
  });

  test('グラフに無いノードでも対象自身は返す (削除は冪等)', () => {
    // 呼び出し側に「存在を確かめてから呼べ」を強いない。二重削除で結果が変わらない
    const missing = nid();
    const removed = cascadeOfNodeRemoval(view([], []), missing);
    expect(ids(removed.nodes)).toEqual([missing]);
  });

  test('親子が循環していても止まる (壊れたデータで無限ループにしない)', () => {
    const a = nid();
    const b = nid();
    const removed = cascadeOfNodeRemoval(
      view(
        [
          [a, b],
          [b, a],
        ],
        [],
      ),
      a,
    );
    // 循環の両方が「a の子孫」に見えるので両方消える。**止まることが要件**である
    expect(ids(removed.nodes)).toEqual([a, b].sort());
  });
});

describe('cascadeOfRemoval', () => {
  test('edge.remove はそのエッジ 1 本だけ。ノードはカスケードしない', () => {
    const a = nid();
    const b = nid();
    const e = eid();
    const removed = cascadeOfRemoval(
      view(
        [
          [a, undefined],
          [b, undefined],
        ],
        [[e, a, b]],
      ),
      {
        kind: 'edge.remove',
        target: e,
      },
    );
    expect(ids(removed.nodes)).toEqual([]);
    expect(ids(removed.edges)).toEqual([e]);
  });

  test('isRemoveOp は削除 op だけを通す', () => {
    const a = nid();
    expect(isRemoveOp({ kind: 'node.remove', target: a })).toBe(true);
    expect(isRemoveOp({ kind: 'edge.remove', target: eid() })).toBe(true);
    expect(isRemoveOp({ kind: 'node.add', target: a, content: 'A' })).toBe(
      false,
    );
    expect(
      isRemoveOp({ kind: 'node.setContent', target: a, content: 'A' }),
    ).toBe(false);
  });
});

// --- 性質: projection が実際に消すものと一致する (Phase 3 T0 の受入基準) ---

/**
 * **ノードは小さなプールから引く。**広い生成器では親子関係もエッジも繋がらず、
 * 「カスケードが起きる形」をほとんど引かない。プールを 5 個に絞り、親も同じプールから
 * 引くことで、入れ子・循環・端点の共有が普通に出るようにしている。
 */
const POOL: NodeId[] = Array.from({ length: 5 }, () => nid());
const someNode = fc.constantFrom(...POOL);
const maybeParent = fc.option(someNode, { nil: undefined });

/** プールのノードを全部 add し、親をランダムに与えるグラフ */
const graphArb = fc.record({
  parents: fc.array(maybeParent, { minLength: 5, maxLength: 5 }),
  edges: fc.array(fc.tuple(someNode, someNode), { maxLength: 6 }),
  removeIndex: fc.nat({ max: 4 }),
});

describe('性質: 規則と projection が同じ集合を出す', () => {
  /**
   * `project.ts` はこの規則を呼んで削除するので、**返した集合と実際に消えた要素が
   * 一致する**ことがここで固定される。片方だけを更新する変更 (集合は正しく求めるが
   * 消し方が違う、あるいはその逆) はこの性質が落とす。
   */
  test('cascadeOfNodeRemoval が返す集合 = projection の前後で消えた要素', () => {
    fc.assert(
      fc.property(graphArb, ({ parents, edges, removeIndex }) => {
        const sheetId = sid();
        const edgeIds = edges.map(() => eid());
        const setup: Op[] = [
          ...POOL.map((id, i) => ({
            kind: 'node.add' as const,
            target: id,
            content: `n${i}`,
            ...(parents[i] !== undefined &&
              parents[i] !== id && { parentId: parents[i] }),
          })),
          ...edges.map(([source, target], i) => ({
            kind: 'edge.add' as const,
            target: edgeIds[i] as EdgeId,
            source,
            dest: target,
          })),
        ];
        const before = projectBatches([{ ...batch(1, setup), sheetId }]);

        const victim = POOL[removeIndex] as NodeId;
        const expected = cascadeOfNodeRemoval(before, victim);

        const after = projectBatches([
          { ...batch(1, setup), sheetId },
          {
            ...batch(2, [{ kind: 'node.remove', target: victim }]),
            sheetId,
          },
        ]);

        const goneNodes = [...before.nodes.keys()].filter(
          (id) => !after.nodes.has(id),
        );
        const goneEdges = [...before.edges.keys()].filter(
          (id) => !after.edges.has(id),
        );
        // 対象が既に消えている場合を除き、期待集合と実際に消えた集合は一致する
        expect(goneNodes.sort()).toEqual(
          [...expected.nodes].filter((id) => before.nodes.has(id)).sort(),
        );
        expect(goneEdges.sort()).toEqual([...expected.edges].sort());
      }),
      { numRuns: 300 },
    );
  });

  /**
   * 規則そのものが述べている不変条件。上の性質と違い**実装を参照しない** —
   * 「消した後に孤児が残らない」はカスケードが存在する理由そのものである。
   */
  test('削除後のグラフに孤児が残らない (親も端点も消えていない)', () => {
    fc.assert(
      fc.property(graphArb, ({ parents, edges, removeIndex }) => {
        const nodes: [NodeId, NodeId | undefined][] = POOL.map((id, i) => [
          id,
          parents[i] === id ? undefined : parents[i],
        ]);
        const edgeIds = edges.map(() => eid());
        const es: [EdgeId, NodeId, NodeId][] = edges.map(([s, t], i) => [
          edgeIds[i] as EdgeId,
          s,
          t,
        ]);
        const g = view(nodes, es);
        const removed = cascadeOfNodeRemoval(g, POOL[removeIndex] as NodeId);

        for (const [id, node] of g.nodes) {
          if (removed.nodes.has(id)) continue;
          // 残ったノードの親は消えていない
          expect(
            node.parentId === undefined || !removed.nodes.has(node.parentId),
          ).toBe(true);
        }
        for (const [id, edge] of g.edges) {
          if (removed.edges.has(id)) continue;
          // 残ったエッジの端点はどちらも消えていない
          expect(removed.nodes.has(edge.source)).toBe(false);
          expect(removed.nodes.has(edge.target)).toBe(false);
        }
      }),
      { numRuns: 300 },
    );
  });
});
