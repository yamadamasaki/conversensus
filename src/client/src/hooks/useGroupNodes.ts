import type { Node } from '@xyflow/react';
import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect } from 'react';
import {
  DEFAULT_NODE_STYLE,
  GROUP_PADDING,
  GROUP_TITLE_HEIGHT,
} from '../graphTransform';

export function useGroupNodes(setNodes: Dispatch<SetStateAction<Node[]>>): {
  groupSelectedNodes: () => void;
} {
  const groupSelectedNodes = useCallback(() => {
    setNodes((ns) => {
      const selected = ns.filter((n) => n.selected);
      if (selected.length < 1) return ns;

      // 選択ノードが同じ親を持つ場合, その親の中にグループを作る
      const sharedParentId = selected.every(
        (n) => n.parentId === selected[0].parentId,
      )
        ? selected[0].parentId
        : undefined;

      // 選択ノードのバウンディングボックスを計算
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
              n.measured?.height ??
                n.style?.height ??
                DEFAULT_NODE_STYLE.height,
            ),
        ),
      );

      const parentX = minX - GROUP_PADDING;
      const parentY = minY - GROUP_PADDING - GROUP_TITLE_HEIGHT;
      const parentWidth = maxX - minX + GROUP_PADDING * 2;
      const parentHeight = maxY - minY + GROUP_PADDING * 2 + GROUP_TITLE_HEIGHT;
      const parentId = crypto.randomUUID();

      const parentNode = {
        id: parentId,
        position: { x: parentX, y: parentY },
        data: { label: 'グループ' },
        type: 'groupNode' as const,
        parentId: sharedParentId,
        style: { width: parentWidth, height: parentHeight, nodeType: 'group' },
      };

      const selectedIds = new Set(selected.map((n) => n.id));

      const mappedNodes = ns.map((n) => {
        if (!selectedIds.has(n.id)) return n;
        return {
          ...n,
          parentId,
          selected: false,
          position: {
            x: n.position.x - parentX,
            y: n.position.y - parentY,
          },
        };
      });

      // React Flow では親ノードを子ノードより前に配置する必要がある
      // ネスト時は sharedParentId の直後に挿入する
      if (sharedParentId) {
        const idx = mappedNodes.findIndex((n) => n.id === sharedParentId);
        const insertAt = idx >= 0 ? idx + 1 : 0;
        return [
          ...mappedNodes.slice(0, insertAt),
          parentNode,
          ...mappedNodes.slice(insertAt),
        ];
      }

      return [parentNode, ...mappedNodes];
    });
  }, [setNodes]);

  // Cmd+G / Ctrl+G でグループ化
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
