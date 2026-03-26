import type { EdgeId, EdgePathType } from '@conversensus/shared';
import type { Edge } from '@xyflow/react';
import type { MouseEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import type { GraphEvent } from '../events/GraphEvent';
import { makeEventBase } from '../events/GraphEvent';

const CONTEXT_MENU_WIDTH = 160;
const CONTEXT_MENU_HEIGHT = 185; // header + 4 items の概算

export type EdgeContextMenuState = {
  targetEdgeIds: string[];
  // 対象が全て同じ種類なら表示, 混在の場合は null
  currentPathType: EdgePathType | null;
  x: number;
  y: number;
} | null;

export function useEdgeContextMenu(
  getEdges: () => Edge[],
  dispatch: (event: GraphEvent) => void,
): {
  contextMenu: EdgeContextMenuState;
  onEdgeContextMenu: (e: MouseEvent, edge: Edge) => void;
  setEdgePathType: (targetEdgeIds: string[], pathType: EdgePathType) => void;
} {
  const [contextMenu, setContextMenu] = useState<EdgeContextMenuState>(null);

  const onEdgeContextMenu = useCallback(
    (e: MouseEvent, edge: Edge) => {
      e.preventDefault();
      const currentEdges = getEdges();
      const targets = edge.selected
        ? currentEdges.filter((ed) => ed.selected)
        : [edge];
      const targetEdgeIds = targets.map((ed) => ed.id);

      const types = targets.map(
        (ed) => (ed.data?.pathType as EdgePathType | undefined) ?? 'bezier',
      );
      const currentPathType = types.every((t) => t === types[0])
        ? types[0]
        : null;

      const x = Math.min(e.clientX, window.innerWidth - CONTEXT_MENU_WIDTH - 8);
      const y = Math.min(
        e.clientY,
        window.innerHeight - CONTEXT_MENU_HEIGHT - 8,
      );
      setContextMenu({ targetEdgeIds, currentPathType, x, y });
    },
    [getEdges],
  );

  const setEdgePathType = useCallback(
    (targetEdgeIds: string[], pathType: EdgePathType) => {
      const currentEdges = getEdges();
      for (const edgeId of targetEdgeIds) {
        const edge = currentEdges.find((e) => e.id === edgeId);
        const fromPathType =
          (edge?.data?.pathType as EdgePathType | undefined) ?? 'bezier';
        dispatch({
          ...makeEventBase('presentation'),
          type: 'EDGE_STYLE_CHANGED',
          edgeId: edgeId as EdgeId,
          from: { pathType: fromPathType },
          to: { pathType },
        });
      }
      setContextMenu(null);
    },
    [getEdges, dispatch],
  );

  // コンテキストメニュー外クリック / ESC で閉じる
  useEffect(() => {
    if (!contextMenu) return;
    const onMouseDown = () => setContextMenu(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  return { contextMenu, onEdgeContextMenu, setEdgePathType };
}
