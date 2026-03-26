import type { MouseEvent } from 'react';
import { useCallback, useRef } from 'react';

const DOUBLE_CLICK_INTERVAL_MS = 300;
const DOUBLE_CLICK_THRESHOLD_PX = 5;

export function usePaneDoubleClick(
  screenToFlowPosition: (pos: { x: number; y: number }) => {
    x: number;
    y: number;
  },
  addNode: (position?: { x: number; y: number }) => void,
): { onPaneClick: (e: MouseEvent) => void } {
  const lastPaneClickTime = useRef(0);
  const lastPaneClickPos = useRef({ x: 0, y: 0 });

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
        const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        addNode(pos);
        lastPaneClickTime.current = 0;
      } else {
        lastPaneClickTime.current = now;
        lastPaneClickPos.current = { x: e.clientX, y: e.clientY };
      }
    },
    [screenToFlowPosition, addNode],
  );

  return { onPaneClick };
}
