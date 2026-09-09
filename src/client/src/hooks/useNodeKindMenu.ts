import type { NodeId, NodeKind } from '@conversensus/shared';
import type { Node } from '@xyflow/react';
import type { MouseEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import type { GraphEvent } from '../events/GraphEvent';
import { makeEventBase } from '../events/GraphEvent';

const CONTEXT_MENU_WIDTH = 160;
/** header + 種別 + 「種別なし」1 行の概算 */
const MENU_ITEM_HEIGHT = 26;
const MENU_HEADER_HEIGHT = 28;

export type NodeKindMenuState = {
  targetNodeIds: string[];
  /** 選べる種別。空なら**メニューそのものを出さない** (設計 D3) */
  nodeKinds: NodeKind[];
  /** 対象が全て同じ種別なら現在値、混在なら null */
  currentLabel: string | null;
  x: number;
  y: number;
} | null;

/**
 * ノードを右クリックして種別を変える (設計 D3)。エッジの `useEdgeContextMenu` と
 * 同じ形にしてある — 選択されているノードが複数ならまとめて変える。
 *
 * **template が当たっていないシートでは開かない。**種別の段が無いのと同じ理由で、
 * 普通のグラフに意味の種別を持ち込まない。
 */
export function useNodeKindMenu(
  getNodes: () => Node[],
  nodeKinds: NodeKind[],
  dispatch: (event: GraphEvent) => void,
): {
  nodeKindMenu: NodeKindMenuState;
  onNodeContextMenu: (e: MouseEvent, node: Node) => void;
  setNodeKind: (targetNodeIds: string[], label: string) => void;
} {
  const [nodeKindMenu, setNodeKindMenu] = useState<NodeKindMenuState>(null);

  const onNodeContextMenu = useCallback(
    (e: MouseEvent, node: Node) => {
      if (nodeKinds.length === 0) return; // template 無し: 既定の右クリックに任せる
      e.preventDefault();
      const current = getNodes();
      const targets = node.selected
        ? current.filter((n) => n.selected)
        : [node];
      const labels = targets.map((n) => String(n.data?.label ?? ''));
      const currentLabel = labels.every((l) => l === labels[0])
        ? (labels[0] ?? null)
        : null;

      const height =
        MENU_HEADER_HEIGHT + (nodeKinds.length + 1) * MENU_ITEM_HEIGHT;
      setNodeKindMenu({
        targetNodeIds: targets.map((n) => n.id),
        nodeKinds,
        currentLabel,
        x: Math.min(e.clientX, window.innerWidth - CONTEXT_MENU_WIDTH - 8),
        y: Math.min(e.clientY, window.innerHeight - height - 8),
      });
    },
    [getNodes, nodeKinds],
  );

  const setNodeKind = useCallback(
    (targetNodeIds: string[], label: string) => {
      const current = getNodes();
      for (const nodeId of targetNodeIds) {
        const from = String(
          current.find((n) => n.id === nodeId)?.data?.label ?? '',
        );
        if (from === label) continue; // 変わらないものを op-log に積まない
        dispatch({
          ...makeEventBase('content'),
          type: 'NODE_LABEL_CHANGED',
          nodeId: nodeId as NodeId,
          from,
          to: label,
        });
      }
      setNodeKindMenu(null);
    },
    [getNodes, dispatch],
  );

  // メニュー外クリック / ESC で閉じる
  useEffect(() => {
    if (!nodeKindMenu) return;
    const onMouseDown = () => setNodeKindMenu(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNodeKindMenu(null);
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [nodeKindMenu]);

  return { nodeKindMenu, onNodeContextMenu, setNodeKind };
}
