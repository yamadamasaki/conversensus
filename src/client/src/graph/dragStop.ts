import type { NodeId } from '@conversensus/shared';
import type { Node } from '@xyflow/react';
import { applyEvent } from '../events/applyEvent';
import type { NodeMovedEvent, NodeReparentedEvent } from '../events/GraphEvent';
import { makeEventBase } from '../events/GraphEvent';
import {
  absolutePositionOf,
  type Position,
  resolveDropTarget,
  toParentRelative,
} from './coords';

/** ドラッグ確定で記録されうるイベント */
export type DragStopEvent = NodeMovedEvent | NodeReparentedEvent;

/** ドラッグ開始時に控えた位置。キーはノード id */
export type PreDragPositions = ReadonlyMap<string, Position>;

// applyEvent はエッジを要求するが NODE_MOVED / NODE_REPARENTED はエッジを触らない
const NO_EDGES: never[] = [];

/**
 * React Flow のドラッグハンドラの引数から, 実際に動いたノードの一覧を取り出す。
 *
 * 複数選択したままドラッグすると React Flow は対象すべてを動かし, 第 3 引数
 * (`nodes`) でその全部を渡してくる。掴んだ 1 個 (第 2 引数) だけを見ると残りの
 * 移動を取りこぼす。第 3 引数が空になるのは動く対象が無いときだけなので,
 * そのときだけ掴んだノードで補う。
 */
export function draggedNodesOf(node: Node, nodes: Node[]): Node[] {
  return nodes.length > 0 ? nodes : [node];
}

/**
 * ドラッグ対象の最新位置を全体のノード配列へ反映する。
 *
 * React Flow がハンドラへ渡すドラッグ対象は position だけが最新で、`measured` などは
 * 元のノードが持っている。逆に `getNodes()` の配列は position が stale でありうる。
 * 両者を混ぜず、**元のノードに最新の position だけを載せた配列**をここで作り、
 * 以降の計算 (祖先を辿る絶対座標、グループ境界) を一つの座標系に揃える。
 */
export function withDraggedPositions(dragged: Node[], nodes: Node[]): Node[] {
  const positionById = new Map(dragged.map((n) => [n.id, n.position]));

  return nodes.map((node) => {
    const position = positionById.get(node.id);
    return position ? { ...node, position } : node;
  });
}

/**
 * ドラッグ対象それぞれの新しい親を解決する。値が undefined はトップレベルを意味する。
 *
 * ドロップ先は**ノードごとにそのノード自身の中心で**決める。掴んだノードの結果を
 * 全体へ適用すると、離れた位置にあるノードが見た目と無関係なグループへ入ってしまう。
 * ハイライト (onNodeDrag) と確定 (onNodeDragStop) の両方がこの関数を共用する。
 */
export function resolveDropTargets(
  dragged: Node[],
  nodes: Node[],
): Map<string, Node | undefined> {
  const withFreshPositions = withDraggedPositions(dragged, nodes);

  return new Map(
    dragged.map((node) => [
      node.id,
      resolveDropTarget(
        withFreshPositions.find((n) => n.id === node.id) ?? node,
        withFreshPositions,
      ),
    ]),
  );
}

/**
 * ドラッグ確定時に記録するイベント列を組み立てる。
 *
 * 複数選択したままドラッグすると React Flow は対象すべてを動かすので、**掴んだ 1 個だけ
 * でなく全部を記録する**。位置が変わっていないノードは何も返さない。
 *
 * イベントは**直前までのイベントを反映した状態に対して**順に組み立てる。
 * `NODE_REPARENTED` は `recalculateParentBounds` を通ってグループの位置と大きさを
 * 変えうるので、最初の 1 個で動いたグループを基準に次の相対座標を求める必要がある。
 */
export function buildDragStopEvents(
  dragged: Node[],
  nodes: Node[],
  preDragPositions: PreDragPositions,
): DragStopEvent[] {
  const events: DragStopEvent[] = [];
  let current = withDraggedPositions(dragged, nodes);

  for (const { id } of dragged) {
    const node = current.find((n) => n.id === id);
    if (!node) continue;

    const event = buildDragStopEvent(node, current, preDragPositions.get(id));
    if (!event) continue;

    events.push(event);
    current = applyEvent(event, current, NO_EDGES).nodes;
  }

  return events;
}

/** 1 ノード分。親が変われば `NODE_REPARENTED`、位置だけ変われば `NODE_MOVED` */
function buildDragStopEvent(
  node: Node,
  nodes: Node[],
  from: Position | undefined,
): DragStopEvent | undefined {
  const oldParentId = node.parentId as NodeId | undefined;
  const newParentId = resolveDropTarget(node, nodes)?.id as NodeId | undefined;

  if (newParentId !== oldParentId) {
    // 親が変わっても画面上の位置は変えない。絶対座標を保ったまま新しい親からの相対へ直す
    const absolute = absolutePositionOf(node, nodes);
    return {
      ...makeEventBase('structure'),
      type: 'NODE_REPARENTED',
      nodeId: node.id as NodeId,
      oldParentId,
      newParentId,
      oldPosition: from ?? node.position,
      newPosition: toParentRelative(absolute, newParentId, nodes),
    };
  }

  if (!from || (from.x === node.position.x && from.y === node.position.y)) {
    return undefined;
  }

  return {
    ...makeEventBase('layout'),
    type: 'NODE_MOVED',
    nodeId: node.id as NodeId,
    from,
    to: { x: node.position.x, y: node.position.y },
  };
}
