/**
 * 削除のカスケード規則 (step2 Phase 3 T0)
 *
 * `node.remove` は対象だけを消すのではない。**子孫ノードと、端点を失うエッジ**も
 * 一緒に消える。この規則は「op に何が書かれているか」ではなく「そのとき状態に
 * 何があるか」に依存するので、状態を見ずに op の `target` だけを読む側からは見えない。
 *
 * **規則をここ 1 箇所に置く理由。**同じ規則が projection (`project.ts`) と競合検出
 * (`merge.ts`) に別々に書かれていると、片方だけが更新されたときに
 * 「projection では消えるのに競合としては検出されない」が静かに戻る。グループの削除は
 * 中身をまとめて消す操作なので、共同作業では直接参照より起こりやすい
 * (`deepse/requirements/spec/merging.md` の S1' / S2')。
 *
 * **`ProjectedGraph` ではなく必要な形だけを受ける。**カスケードの計算に要るのは
 * 親子関係とエッジの端点だけである。projection の全体を要求すると、状態を組み立てる
 * 側 (検出器・計測) がこのモジュールを使えなくなる。
 */

import type { EdgeId, NodeId } from '../schemas';
import type { Op } from './unified';

/** カスケードの計算に要るぶんだけのグラフ。`ProjectedGraph` はそのまま渡せる */
export type CascadeGraphView = {
  nodes: ReadonlyMap<NodeId, { parentId?: NodeId }>;
  edges: ReadonlyMap<EdgeId, { source: NodeId; target: NodeId }>;
};

/** 実際に消える要素の集合 */
export type RemovedElements = {
  nodes: ReadonlySet<NodeId>;
  edges: ReadonlySet<EdgeId>;
};

/** 削除 op。カスケードの起点になりうるのはこの 2 つだけである */
export type RemoveOp = Extract<Op, { kind: 'node.remove' | 'edge.remove' }>;

/** 削除 op か。`kind` で絞るので呼び出し側が `Op` のまま判定できる */
export function isRemoveOp(op: Op): op is RemoveOp {
  return op.kind === 'node.remove' || op.kind === 'edge.remove';
}

// 親子チェーンを辿るループの上限。データ破損で循環参照ができても停止させる
const MAX_PARENT_HOPS = 100;

/** parentId から親を辿って ancestorId に行き着くか。配列やマップの順序に依存しない */
function hasAncestor(
  parentId: NodeId | undefined,
  ancestorId: NodeId,
  g: CascadeGraphView,
): boolean {
  let current: NodeId | undefined = parentId;
  for (let hop = 0; current && hop < MAX_PARENT_HOPS; hop++) {
    if (current === ancestorId) return true;
    current = g.nodes.get(current)?.parentId;
  }
  return false;
}

/**
 * `node.remove` が実際に消す要素。**対象・その子孫・端点を失うエッジ**。
 *
 * 対象がグラフに無くても対象自身は結果に含める。削除は冪等なので「既に消えている」と
 * 「今消す」を区別しない — 呼び出し側が存在を確かめてから呼ぶ必要が無いようにする。
 */
export function cascadeOfNodeRemoval(
  g: CascadeGraphView,
  target: NodeId,
): RemovedElements {
  const nodes = new Set<NodeId>([target]);
  for (const [id, node] of g.nodes) {
    if (hasAncestor(node.parentId, target, g)) nodes.add(id);
  }

  const edges = new Set<EdgeId>();
  for (const [edgeId, edge] of g.edges) {
    if (nodes.has(edge.source) || nodes.has(edge.target)) edges.add(edgeId);
  }
  return { nodes, edges };
}

/**
 * 削除 op が実際に消す要素。`edge.remove` はそのエッジ 1 本だけで、カスケードしない。
 *
 * 競合検出はこの集合に対して削除依存を判定する — 「op に書かれた id」で判定すると
 * グループ削除で子への依存を取り逃す。
 */
export function cascadeOfRemoval(
  g: CascadeGraphView,
  op: RemoveOp,
): RemovedElements {
  return op.kind === 'node.remove'
    ? cascadeOfNodeRemoval(g, op.target)
    : { nodes: new Set<NodeId>(), edges: new Set<EdgeId>([op.target]) };
}
