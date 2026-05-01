import type { MouseEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

const DOUBLE_CLICK_INTERVAL_MS = 300;
const DOUBLE_CLICK_THRESHOLD_PX = 5;

export type NodeTypeMenuState = {
  screenPos: { x: number; y: number };
  flowPos: { x: number; y: number };
} | null;

export function usePaneDoubleClick(
  screenToFlowPosition: (pos: { x: number; y: number }) => {
    x: number;
    y: number;
  },
): {
  onPaneClick: (e: MouseEvent) => void;
  nodeTypeMenu: NodeTypeMenuState;
  clearNodeTypeMenu: () => void;
} {
  const lastPaneClickTime = useRef(0);
  const lastPaneClickPos = useRef({ x: 0, y: 0 });
  const [nodeTypeMenu, setNodeTypeMenu] = useState<NodeTypeMenuState>(null);

  const onPaneClick = useCallback(
    (e: MouseEvent) => {
      const now = Date.now();
      const dx = e.clientX - lastPaneClickPos.current.x;
      const dy = e.clientY - lastPaneClickPos.current.y;
      const isSameSpot =
        Math.abs(dx) < DOUBLE_CLICK_THRESHOLD_PX &&
        Math.abs(dy) < DOUBLE_CLICK_THRESHOLD_PX;
      if (
        now - lastPaneClickTime.current < DOUBLE_CLICK_INTERVAL_MS &&
        isSameSpot
      ) {
        const flowPos = screenToFlowPosition({
          x: e.clientX,
          y: e.clientY,
        });
        setNodeTypeMenu({
          screenPos: { x: e.clientX, y: e.clientY },
          flowPos,
        });
        lastPaneClickTime.current = 0;
      } else {
        lastPaneClickTime.current = now;
        lastPaneClickPos.current = { x: e.clientX, y: e.clientY };
      }
    },
    [screenToFlowPosition],
  );

  const clearNodeTypeMenu = useCallback(() => setNodeTypeMenu(null), []);

  // メニュー外クリック / ESC で閉じる
  useEffect(() => {
    if (!nodeTypeMenu) return;
    const onMouseDown = () => setNodeTypeMenu(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNodeTypeMenu(null);
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [nodeTypeMenu]);

  return { onPaneClick, nodeTypeMenu, clearNodeTypeMenu };
}
