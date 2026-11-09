/**
 * node のそばの操作 (計画 N2、Q1 案 a)
 *
 * 選んだ node の上に、その node に使える操作を並べる。React Flow の `NodeToolbar` を使うので、
 * node を動かしても拡大縮小してもついて行く。**node の部品 (`EditableNode`) には手を入れない** —
 * `NodeToolbar` は `nodeId` を渡せば ReactFlow の中のどこに置いてもその node に付く。
 */

import { NodeToolbar, Position } from '@xyflow/react';
import { useLocale, useMessages } from '../i18n/messages';
import { space } from '../theme';
import { Button } from '../ui/Button';
import type { AvailableAction } from './registry';

type Props = {
  nodeId: string;
  actions: readonly AvailableAction[];
  onPick: (nodeId: string, found: AvailableAction) => void;
};

/** node と操作の間 */
const TOOLBAR_OFFSET = 8;

export function NodeActionBar({ nodeId, actions, onPick }: Props) {
  const t = useMessages();
  const locale = useLocale();
  return (
    <NodeToolbar
      nodeId={nodeId}
      isVisible
      position={Position.Top}
      offset={TOOLBAR_OFFSET}
    >
      {/* 操作は canvas の拡大縮小の領域の中にある。押しただけで canvas が動き出さないよう、
          React Flow の印 (`nodrag`・`nopan`) を付ける */}
      <div
        role="toolbar"
        aria-label={t.nodeActions.region}
        className="nodrag nopan"
        style={{ display: 'flex', gap: space[1] }}
      >
        {actions.map((found) => (
          <Button
            key={found.key}
            className="cs-btn--sm"
            onClick={() => onPick(nodeId, found)}
          >
            {found.action.label[locale]}
          </Button>
        ))}
      </div>
    </NodeToolbar>
  );
}
