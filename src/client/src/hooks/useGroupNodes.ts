import type { GraphNode, NodeId, NodeLayout } from '@conversensus/shared';
import type { Node } from '@xyflow/react';
import { useCallback, useEffect } from 'react';
import type { GraphEvent } from '../events/GraphEvent';
import { makeEventBase } from '../events/GraphEvent';
import {
  DEFAULT_NODE_STYLE,
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

    const minX = Math.min(...selected.map((n) => n.position.x));
    const minY = Math.min(...selected.map((n) => n.position.y));
    const maxX = Math.max(
      ...selected.map(
        (n) =>
          n.position.x +
          Number(
            n.measured?.width ?? n.style?.width ?? DEFAULT_NODE_STYLE.width,
          ),
      ),
    );
    const maxY = Math.max(
      ...selected.map(
        (n) =>
          n.position.y +
          Number(
            n.measured?.height ?? n.style?.height ?? DEFAULT_NODE_STYLE.height,
          ),
      ),
    );

    const parentX = minX - GROUP_PADDING;
    const parentY = minY - GROUP_PADDING - GROUP_TITLE_HEIGHT;
    const parentWidth = maxX - minX + GROUP_PADDING * 2;
    const parentHeight = maxY - minY + GROUP_PADDING * 2 + GROUP_TITLE_HEIGHT;
    const parentId = crypto.randomUUID() as NodeId;

    const parentData: GraphNode = {
      id: parentId,
      content: 'グループ',
      parentId: sharedParentId as NodeId | undefined,
    };

    const parentLayout: NodeLayout = {
      nodeId: parentId,
      x: parentX,
      y: parentY,
      width: parentWidth,
      height: parentHeight,
      nodeType: 'group',
    };

    const children = selected.map((n) => ({
      nodeId: n.id as NodeId,
      originalParentId: n.parentId as NodeId | undefined,
      originalPosition: {
        x: n.position.x,
        y: n.position.y,
      },
      newPosition: {
        x: n.position.x - parentX,
        y: n.position.y - parentY,
      },
    }));

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
