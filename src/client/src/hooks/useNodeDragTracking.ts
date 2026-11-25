/**
 * ノードのドラッグを op に変える (step3 Phase 0 S0-2 で `GraphEditor` から切り出した)。
 *
 * - 開始時に全ノードの位置を控える (移動の `from` になる)
 * - ドラッグ中は、入ろうとしているグループ・出ようとしているグループに印を付ける
 *   (色は `index.css` が属性から塗る)
 * - 確定時に、控えた位置と今の位置から `NODE_MOVED` / `NODE_REPARENTED` を作って流す
 *
 * **判断は `graph/dragStop.ts` にある** — 移動先の解決と event の組み立てはそこで、
 * ここは React Flow のコールバックと DOM の印の配線だけである。ドラッグ中の印と確定時の
 * 移動先は**同じ関数 (`resolveDropTargets`) で解決する**ので、見えたとおりに動く。
 */

import type { Node, OnNodeDrag } from '@xyflow/react';
import { useCallback, useRef } from 'react';
import type { GraphEvent } from '../events/GraphEvent';
import {
  buildDragStopEvents,
  type DragPointer,
  draggedNodesOf,
  resolveDropTargets,
} from '../graph/dragStop';

/** グループへ入ろうとしている印 */
export const DROP_TARGET_ATTR = 'data-drop-target';
/** グループから出ようとしている印 */
export const LEAVING_GROUP_ATTR = 'data-leaving-group';

type Position = { x: number; y: number };

function clearDragHighlights(): void {
  for (const attr of [DROP_TARGET_ATTR, LEAVING_GROUP_ATTR]) {
    for (const el of document.querySelectorAll(`[${attr}="true"]`)) {
      el.removeAttribute(attr);
    }
  }
}

function markNode(nodeId: string, attr: string): void {
  document
    .querySelector(`.react-flow__node[data-id="${nodeId}"]`)
    ?.setAttribute(attr, 'true');
}

/** ドラッグの event からカーソルの画面座標を取る。指を離したときの touch は `changedTouches` にしか無い */
function clientPointOf(event: MouseEvent | TouchEvent): Position | undefined {
  if ('clientX' in event) return { x: event.clientX, y: event.clientY };
  // 座標を持たない event (合成のものなど) では中心で決める
  if (!('changedTouches' in event)) return undefined;
  const touch = event.touches[0] ?? event.changedTouches[0];
  return touch ? { x: touch.clientX, y: touch.clientY } : undefined;
}

/**
 * @param screenToFlowPosition 画面座標を flow 座標にする (React Flow の `useReactFlow`)。掴んだ node が入る
 *   group をカーソルの位置で決めるのに使う (#407)
 */
export function useNodeDragTracking(
  getNodes: () => Node[],
  dispatch: (event: GraphEvent) => void,
  screenToFlowPosition: (point: Position) => Position,
) {
  const preDragPositionsRef = useRef<Map<string, Position>>(new Map());
  const pointerOf = useCallback(
    (event: MouseEvent | TouchEvent, node: Node): DragPointer | undefined => {
      const client = clientPointOf(event);
      return client
        ? { nodeId: node.id, at: screenToFlowPosition(client) }
        : undefined;
    },
    [screenToFlowPosition],
  );

  // 型は React Flow の `OnNodeDrag` に合わせる (12.12 で event が DOM の MouseEvent | TouchEvent になった)
  const onNodeDragStart = useCallback<OnNodeDrag>(() => {
    preDragPositionsRef.current = new Map(
      getNodes().map((n) => [n.id, { x: n.position.x, y: n.position.y }]),
    );
  }, [getNodes]);

  const onNodeDrag = useCallback<OnNodeDrag>(
    (event, node, nodes) => {
      const dragged = draggedNodesOf(node, nodes);
      clearDragHighlights();

      const targets = resolveDropTargets(
        dragged,
        getNodes(),
        pointerOf(event, node),
      );
      for (const draggedNode of dragged) {
        const target = targets.get(draggedNode.id);
        const oldParentId = draggedNode.parentId;
        if (target?.id === oldParentId) continue;
        if (oldParentId) markNode(oldParentId, LEAVING_GROUP_ATTR);
        if (target) markNode(target.id, DROP_TARGET_ATTR);
      }
    },
    [getNodes, pointerOf],
  );

  const onNodeDragStop = useCallback<OnNodeDrag>(
    (event, node, nodes) => {
      clearDragHighlights();
      const events = buildDragStopEvents(
        draggedNodesOf(node, nodes),
        getNodes(),
        preDragPositionsRef.current,
        pointerOf(event, node),
      );
      for (const graphEvent of events) dispatch(graphEvent);
    },
    [dispatch, getNodes, pointerOf],
  );

  return { onNodeDragStart, onNodeDrag, onNodeDragStop };
}
