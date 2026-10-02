/**
 * 見るだけの pane (step3 Phase 3 S3-5, multiple モード)
 *
 * アクティブでない pane はこれで描く。**キー操作を張らない** — `GraphEditor` は undo・コピー・
 * 貼り付け・削除などを window に張るので、pane の数だけ描くと 1 回のキー操作がすべての pane に効く。
 * ここは React Flow で描くだけで、動かす・繋ぐ・選ぶ・文字を編集するをすべて止める。
 * 寄せる・拡げる (pan / zoom) は読むための操作なので残す。
 *
 * ノードの部品は編集の口 (`useEventDispatch` / `useNodeCreation`) を求めるので、**何もしない口**を
 * 渡す。読み取り専用 (`ReadOnlyProvider`) も立てて、文字の編集を始めさせない
 */

import type { Sheet } from '@conversensus/shared';
import { Background, ReactFlow, ReactFlowProvider } from '@xyflow/react';
import { useMemo } from 'react';
import { EventDispatchContext } from './EventDispatchContext';
import { FLOW_EDGE_TYPES, FLOW_NODE_TYPES } from './graph/flowTypes';
import { toFlowEdges, toFlowNodes } from './graphTransform';
import { NodeCreationContext } from './NodeCreationContext';
import { ReadOnlyProvider } from './readOnlyContext';

const NOTHING = () => {};
const INERT_DISPATCH = { dispatch: NOTHING, setDragging: NOTHING };
const INERT_CREATION = { openNodeTypeMenu: NOTHING };

export function GraphPreview({ sheet }: { sheet: Sheet }) {
  const nodes = useMemo(
    () => toFlowNodes(sheet.nodes, sheet.layouts ?? []),
    [sheet],
  );
  const edges = useMemo(
    () => toFlowEdges(sheet.edges, sheet.edgeLayouts ?? []),
    [sheet],
  );
  return (
    <ReadOnlyProvider value={true}>
      <EventDispatchContext.Provider value={INERT_DISPATCH}>
        <NodeCreationContext.Provider value={INERT_CREATION}>
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={FLOW_NODE_TYPES}
              edgeTypes={FLOW_EDGE_TYPES}
              nodesDraggable={false}
              nodesConnectable={false}
              edgesReconnectable={false}
              elementsSelectable={false}
              zoomOnDoubleClick={false}
              deleteKeyCode={null}
              fitView
            >
              <Background />
            </ReactFlow>
          </ReactFlowProvider>
        </NodeCreationContext.Provider>
      </EventDispatchContext.Provider>
    </ReadOnlyProvider>
  );
}
