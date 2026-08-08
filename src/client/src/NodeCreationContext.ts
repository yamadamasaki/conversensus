import type { NodeId } from '@conversensus/shared';
import { createContext, useContext } from 'react';
import type { Position } from './graph/coords';

type NodeCreationContextValue = {
  /** ノードの種類を選ばせるメニューを開く。containerId 省略でトップレベル */
  openNodeTypeMenu: (screenPos: Position, containerId?: NodeId) => void;
};

/**
 * ノード生成の入り口をノード・コンポーネントへ渡す。
 * グループ本体のダブルクリックも pane と同じメニューを通す (設計 D5) ため、
 * `GroupNode` から `GraphEditor` のメニューを開けるようにする。
 */
export const NodeCreationContext =
  createContext<NodeCreationContextValue | null>(null);

export function useNodeCreation(): NodeCreationContextValue {
  const ctx = useContext(NodeCreationContext);
  if (!ctx)
    throw new Error(
      'useNodeCreation must be used within NodeCreationContext.Provider',
    );
  return ctx;
}
