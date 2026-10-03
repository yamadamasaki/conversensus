/**
 * metagraph の graph node の口 (step3 Phase 4 S4-2b)。`EditableNode` は React Flow が描くので
 * props が届かず、context で降ろす (`blobOriginContext` と同じ理由)
 *
 * - `openSheet`: graph node のダブルクリックで、そのシートを開く (Q6)
 * - `renameRequest`: 名前の変更を始める graph node (選んで Enter / F2)。ダブルクリックは開くに使うので、
 *   文字の編集の入口を別に持つ
 */

import type { NodeId, SheetId } from '@conversensus/shared';
import { createContext, useContext } from 'react';

export type GraphNodeHandlers = {
  openSheet: (sheetId: SheetId) => void;
  renameRequest: NodeId | null;
  clearRenameRequest: () => void;
};

/** 既定は metagraph でない (graph node の口が無い)。ダブルクリックは今までどおり文字の編集 */
const GraphNodeContext = createContext<GraphNodeHandlers | null>(null);

export const GraphNodeProvider = GraphNodeContext.Provider;

export function useGraphNodeHandlers(): GraphNodeHandlers | null {
  return useContext(GraphNodeContext);
}
