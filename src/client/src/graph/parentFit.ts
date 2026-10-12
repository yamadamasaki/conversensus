/**
 * 親 group を中身に合わせて広げた分を、操作の event に載せる (#250 無限キャンバス)
 *
 * node を動かす・親を変える・大きさを変えると、はみ出した分だけ親の group の枠が広がる
 * (`recalculateParentBounds`)。左・上へはみ出したなら group 自身が左上へ動き、兄弟の相対座標も
 * ずれる。以前はこれを**画面の上でだけ**行っていたので、op-log には残らず、再読み込みや
 * 他の端末では元の枠に戻っていた (中身がはみ出したまま)。
 *
 * そこで dispatch の入口でこの変化を求め、`fitted` として event に載せる。`toUnified` が同じ
 * batch の layout op にし、`invertEvent` が逆向きにするので、undo の 1 歩で一緒に戻る。
 */

import type { Edge, Node } from '@xyflow/react';
import { applyEvent } from '../events/applyEvent';
import type {
  GraphEvent,
  LayoutFit,
  NodeBox,
  NodeMovedEvent,
  NodeReparentedEvent,
  NodeResizedEvent,
} from '../events/GraphEvent';
import { RF_GROUP_NODE_TYPE, recalculateParentBounds } from '../graphTransform';

type FittableEvent = NodeMovedEvent | NodeReparentedEvent | NodeResizedEvent;

/**
 * 入れ子の group を外へ向かって広げる回数の上限。`recalculateParentBounds` は 1 回で 1 段だけ
 * 広げるので、内側の group が広がって外側からはみ出した分は次の回で広がる
 */
const MAX_FIT_PASSES = 16;

function isFittable(event: GraphEvent): event is FittableEvent {
  return (
    event.type === 'NODE_MOVED' ||
    event.type === 'NODE_REPARENTED' ||
    event.type === 'NODE_RESIZED'
  );
}

/** 大きさは画面が測った値と指定の大きい方 (`recalculateParentBounds` と同じ見方) */
function sizeOf(
  style: number | string | undefined,
  measured: number | undefined,
): number | undefined {
  const values = [Number(style), measured].filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  );
  return values.length > 0 ? Math.max(...values) : undefined;
}

/**
 * 置き場所と大きさ。**大きさは group の枠だけ**に付ける — 広がるのは group だけで、ずれるだけの
 * 兄弟に大きさを書くと、中身に合わせて伸びる node の大きさが固定されてしまう
 */
function boxOf(node: Node): NodeBox {
  if (node.type !== RF_GROUP_NODE_TYPE) {
    return { x: node.position.x, y: node.position.y };
  }
  const width = sizeOf(
    node.style?.width as number | string | undefined,
    node.measured?.width,
  );
  const height = sizeOf(
    node.style?.height as number | string | undefined,
    node.measured?.height,
  );
  return {
    x: node.position.x,
    y: node.position.y,
    ...(width !== undefined && { width }),
    ...(height !== undefined && { height }),
  };
}

function sameBox(a: NodeBox, b: NodeBox): boolean {
  return (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  );
}

/** 操作そのものだけを当てた姿 (親を広げる前)。広げた分はここからの差である */
function withoutFit(event: FittableEvent, nodes: Node[]): Node[] {
  return nodes.map((n) => {
    if (n.id !== event.nodeId) return n;
    switch (event.type) {
      case 'NODE_MOVED':
        return { ...n, position: event.to };
      case 'NODE_REPARENTED':
        return { ...n, position: event.newPosition };
      case 'NODE_RESIZED':
        return {
          ...n,
          style: { ...n.style, width: event.to.width, height: event.to.height },
        };
      default:
        return n;
    }
  });
}

/**
 * 親 group を広げた分を求めて `fitted` に載せる。広げる必要が無ければ、または既に載っていれば
 * (undo / redo の event) そのまま返す。
 *
 * `from` は**操作の前**の姿、`to` は広げた後の姿である。操作した node 自身も、親が左・上へ
 * 広がって相対座標がずれたなら含める — `from` を操作の前の姿にしておくと、undo で操作そのもの
 * (元の位置へ戻す) と食い違わない
 */
export function withParentFit<E extends GraphEvent>(
  event: E,
  nodes: Node[],
  edges: Edge[],
): E {
  if (!isFittable(event) || event.fitted) return event;
  let after = applyEvent(event, nodes, edges).nodes;
  for (let i = 0; i < MAX_FIT_PASSES; i++) {
    const next = recalculateParentBounds(after);
    if (next === after) break;
    after = next;
  }
  const before = new Map(nodes.map((n) => [n.id, n]));
  const base = new Map(withoutFit(event, nodes).map((n) => [n.id, n]));
  const fitted: LayoutFit[] = after.flatMap((n) => {
    const prior = before.get(n.id);
    const unfitted = base.get(n.id);
    if (!prior || !unfitted) return [];
    const to = boxOf(n);
    if (sameBox(boxOf(unfitted), to)) return [];
    return [{ nodeId: n.id as LayoutFit['nodeId'], from: boxOf(prior), to }];
  });
  return fitted.length > 0 ? { ...event, fitted } : event;
}
