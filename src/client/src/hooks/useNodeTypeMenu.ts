import type { NodeId } from '@conversensus/shared';
import type { Node } from '@xyflow/react';
import type { MouseEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type Position, toParentRelative } from '../graph/coords';

const DOUBLE_CLICK_INTERVAL_MS = 300;
const DOUBLE_CLICK_THRESHOLD_PX = 5;

export type NodeTypeMenuState = {
  /** メニューを表示する画面座標 */
  screenPos: Position;
  /** 生成先コンテナから見た, 新しいノードの位置 */
  position: Position;
  /** 生成先コンテナ (グループ)。undefined ならトップレベル */
  containerId?: NodeId;
} | null;

/**
 * ノード生成の入り口。pane でもグループ本体でも, ダブルクリックしたら
 * まず `NodeTypeMenu` を出し, 種類が選ばれてから生成する (設計 D5)。
 *
 * 生成先コンテナ (pane = undefined / グループ = その id) をメニューの状態に持たせ,
 * 位置をコンテナ相対に直すところまでをここで済ませる。呼び出し側は
 * 「どこに何を作るか」だけを受け取ればよい。
 */
export function useNodeTypeMenu(
  screenToFlowPosition: (pos: Position) => Position,
  getNodes: () => Node[],
): {
  onPaneClick: (e: MouseEvent) => void;
  openNodeTypeMenu: (screenPos: Position, containerId?: NodeId) => void;
  nodeTypeMenu: NodeTypeMenuState;
  clearNodeTypeMenu: () => void;
} {
  const lastPaneClickTime = useRef(0);
  const lastPaneClickPos = useRef({ x: 0, y: 0 });
  const [nodeTypeMenu, setNodeTypeMenu] = useState<NodeTypeMenuState>(null);

  const openNodeTypeMenu = useCallback(
    (screenPos: Position, containerId?: NodeId) => {
      const flowPos = screenToFlowPosition(screenPos);
      setNodeTypeMenu({
        screenPos,
        position: containerId
          ? toParentRelative(flowPos, containerId, getNodes())
          : flowPos,
        ...(containerId ? { containerId } : {}),
      });
    },
    [screenToFlowPosition, getNodes],
  );

  // pane では React の onDoubleClick が使えない (ReactFlow が pane のイベントを
  // 握るため) ので, クリックの間隔と距離から自前でダブルクリックを判定する
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
        openNodeTypeMenu({ x: e.clientX, y: e.clientY });
        lastPaneClickTime.current = 0;
      } else {
        lastPaneClickTime.current = now;
        lastPaneClickPos.current = { x: e.clientX, y: e.clientY };
      }
    },
    [openNodeTypeMenu],
  );

  const clearNodeTypeMenu = useCallback(() => setNodeTypeMenu(null), []);

  // メニュー外クリック / ESC で閉じる
  // ReactFlow が pane 上のイベント伝播を止めるため capture フェーズで捕捉する
  useEffect(() => {
    if (!nodeTypeMenu) return;
    const onMouseDown = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-node-type-menu]')) return;
      setNodeTypeMenu(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNodeTypeMenu(null);
    };
    window.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [nodeTypeMenu]);

  return { onPaneClick, openNodeTypeMenu, nodeTypeMenu, clearNodeTypeMenu };
}
