import type { EdgePathType } from '@conversensus/shared';
import type { Edge } from '@xyflow/react';
import type { Dispatch, MouseEvent, SetStateAction } from 'react';
import { useCallback, useEffect, useState } from 'react';

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
  setEdges: Dispatch<SetStateAction<Edge[]>>,
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
      // 右クリックした edge が選択中なら選択中の全 edge を対象にする
      const targets = edge.selected
        ? currentEdges.filter((ed) => ed.selected)
        : [edge];
      const targetEdgeIds = targets.map((ed) => ed.id);

      // 対象エッジの pathType が全て一致するか確認
      const types = targets.map(
        (ed) => (ed.data?.pathType as EdgePathType | undefined) ?? 'bezier',
      );
      const currentPathType = types.every((t) => t === types[0])
        ? types[0]
        : null;

      // 画面端からはみ出さないよう位置を補正
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
      const targetSet = new Set(targetEdgeIds);
      setEdges((es) =>
        es.map((e) =>
          targetSet.has(e.id) ? { ...e, data: { ...e.data, pathType } } : e,
        ),
      );
      setContextMenu(null);
    },
    [setEdges],
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
