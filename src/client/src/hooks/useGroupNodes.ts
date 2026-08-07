import type { GraphNode, NodeId, NodeLayout } from '@conversensus/shared';
import type { Node } from '@xyflow/react';
import { useCallback, useEffect } from 'react';
import type { GraphEvent } from '../events/GraphEvent';
import { makeEventBase } from '../events/GraphEvent';
import {
  absoluteBoundingBoxOf,
  absolutePositionOf,
  toParentRelative,
} from '../graph/coords';
import {
  GROUP_NODE_TYPE,
  GROUP_PADDING,
  GROUP_TITLE_HEIGHT,
} from '../graphTransform';

export function useGroupNodes(
  getNodes: () => Node[],
  dispatch: (event: GraphEvent) => void,
): { groupSelectedNodes: () => void } {
  const groupSelectedNodes = useCallback(() => {
    const ns = getNodes();
    const selected = ns.filter((n) => n.selected);
    if (selected.length < 1) return;

    const sharedParentId = selected.every(
      (n) => n.parentId === selected[0].parentId,
    )
      ? selected[0].parentId
      : undefined;

    // 選択ノードの親は揃っているとは限らない (sharedParentId === undefined の場合)。
    // 座標系の混在を避けるため絶対座標で外接矩形を求める。
    const box = absoluteBoundingBoxOf(selected, ns);
    if (!box) return;

    const parentAbsolute = {
      x: box.minX - GROUP_PADDING,
      y: box.minY - GROUP_PADDING - GROUP_TITLE_HEIGHT,
    };
    const parentWidth = box.maxX - box.minX + GROUP_PADDING * 2;
    const parentHeight =
      box.maxY - box.minY + GROUP_PADDING * 2 + GROUP_TITLE_HEIGHT;
    const parentId = crypto.randomUUID() as NodeId;

    const parentData: GraphNode = {
      id: parentId,
      content: 'グループ',
      nodeType: GROUP_NODE_TYPE,
      ...(sharedParentId ? { parentId: sharedParentId as NodeId } : {}),
    };

    // グループ自身の position は、その親 (sharedParentId) から見た相対座標である
    const parentPosition = toParentRelative(parentAbsolute, sharedParentId, ns);

    const parentLayout: NodeLayout = {
      nodeId: parentId,
      x: parentPosition.x,
      y: parentPosition.y,
      width: parentWidth,
      height: parentHeight,
    };

    const children = selected.map((n) => {
      const absolute = absolutePositionOf(n, ns);
      return {
        nodeId: n.id as NodeId,
        originalParentId: n.parentId as NodeId | undefined,
        originalPosition: {
          x: n.position.x,
          y: n.position.y,
        },
        newPosition: {
          x: absolute.x - parentAbsolute.x,
          y: absolute.y - parentAbsolute.y,
        },
      };
    });

    dispatch({
      ...makeEventBase('structure'),
      type: 'NODES_GROUPED',
      parentId,
      parentData,
      parentLayout,
      children,
    });
  }, [getNodes, dispatch]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'g') {
        e.preventDefault();
        groupSelectedNodes();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [groupSelectedNodes]);

  return { groupSelectedNodes };
}
