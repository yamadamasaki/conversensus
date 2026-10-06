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

export function useNodeDragTracking(
  getNodes: () => Node[],
  dispatch: (event: GraphEvent) => void,
) {
  const preDragPositionsRef = useRef<Map<string, Position>>(new Map());

  // 型は React Flow の `OnNodeDrag` に合わせる (12.12 で event が DOM の MouseEvent | TouchEvent になった)
  const onNodeDragStart = useCallback<OnNodeDrag>(() => {
    preDragPositionsRef.current = new Map(
      getNodes().map((n) => [n.id, { x: n.position.x, y: n.position.y }]),
    );
  }, [getNodes]);

  const onNodeDrag = useCallback<OnNodeDrag>(
    (_, node, nodes) => {
      const dragged = draggedNodesOf(node, nodes);
      clearDragHighlights();

      const targets = resolveDropTargets(dragged, getNodes());
      for (const draggedNode of dragged) {
        const target = targets.get(draggedNode.id);
        const oldParentId = draggedNode.parentId;
        if (target?.id === oldParentId) continue;
        if (oldParentId) markNode(oldParentId, LEAVING_GROUP_ATTR);
        if (target) markNode(target.id, DROP_TARGET_ATTR);
      }
    },
    [getNodes],
  );

  const onNodeDragStop = useCallback<OnNodeDrag>(
    (_, node, nodes) => {
      clearDragHighlights();
      const events = buildDragStopEvents(
        draggedNodesOf(node, nodes),
        getNodes(),
        preDragPositionsRef.current,
      );
      for (const event of events) dispatch(event);
    },
    [dispatch, getNodes],
  );

  return { onNodeDragStart, onNodeDrag, onNodeDragStop };
}
