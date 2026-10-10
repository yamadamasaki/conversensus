import { color } from './theme';
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
import type { DiffMarks } from './sync/merger';

const NOTHING = () => {};
/** 複数を選ぶ押し方か (⌘ / Ctrl / Shift) */
const isAdditive = (e: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}) => e.metaKey || e.ctrlKey || e.shiftKey;
const INERT_DISPATCH = { dispatch: NOTHING, setDragging: NOTHING };
const INERT_CREATION = { openNodeTypeMenu: NOTHING };

/**
 * 見るだけの pane に付ける印 (step3 Phase 5 S5-1b, merger)。差分は branch の表示と同じ色分け、
 * 競合は点線で囲い、選択は他の pane で選ばれた要素を同じ見た目にする (選択の正はアクティブな pane)
 */
export type PreviewMarks = DiffMarks & {
  conflicts: Set<string>;
  selected: Set<string>;
};

/**
 * 競合の印。差分の色 (枠の色) とは別の描き方にする (仕様: 差分表示とは異なる方法で競合表示する)。
 * 一括指定 (`outline`) ではなく個別に書く — 値に CSS 変数を含む一括指定は, happy-dom が
 * 正しく分解できず App 結合のテストから見えなくなる
 */
const CONFLICT_OUTLINE = {
  outlineWidth: 2,
  outlineStyle: 'dashed',
  outlineColor: color.conflict,
  outlineOffset: 4,
} as const;

type Props = {
  sheet: Sheet;
  marks?: PreviewMarks;
  /**
   * 要素 (node / edge) を押した。選択を連動させるのに使う。`additive` は ⌘ / Ctrl / Shift を押しながら
   * (複数を選ぶ)
   */
  onElementClick?: (id: string, additive: boolean) => void;
  /** 要素の上で右クリックした (merger の「取り込む」のメニュー) */
  onElementContextMenu?: (id: string, at: { x: number; y: number }) => void;
};

export function GraphPreview({
  sheet,
  marks,
  onElementClick,
  onElementContextMenu,
}: Props) {
  const nodes = useMemo(
    () =>
      toFlowNodes(
        sheet.nodes,
        sheet.layouts ?? [],
        marks?.addedNodes,
        marks?.updatedNodes,
      ).map((n) => ({
        ...n,
        selected: marks?.selected.has(n.id) ?? false,
        ...(marks?.conflicts.has(n.id) && {
          style: { ...n.style, ...CONFLICT_OUTLINE },
        }),
      })),
    [sheet, marks],
  );
  const edges = useMemo(
    () =>
      toFlowEdges(
        sheet.edges,
        sheet.edgeLayouts ?? [],
        marks?.addedEdges,
        marks?.updatedEdges,
      ).map((e) => ({
        ...e,
        selected: marks?.selected.has(e.id) ?? false,
        ...(marks?.conflicts.has(e.id) && {
          style: { ...e.style, strokeDasharray: '6 4', stroke: color.conflict },
        }),
      })),
    [sheet, marks],
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
              {...(onElementClick && {
                onNodeClick: (e, node) =>
                  onElementClick(node.id, isAdditive(e)),
                onEdgeClick: (e, edge) =>
                  onElementClick(edge.id, isAdditive(e)),
              })}
              {...(onElementContextMenu && {
                onNodeContextMenu: (e, node) => {
                  e.preventDefault();
                  onElementContextMenu(node.id, { x: e.clientX, y: e.clientY });
                },
                onEdgeContextMenu: (e, edge) => {
                  e.preventDefault();
                  onElementContextMenu(edge.id, { x: e.clientX, y: e.clientY });
                },
              })}
            >
              <Background />
            </ReactFlow>
          </ReactFlowProvider>
        </NodeCreationContext.Provider>
      </EventDispatchContext.Provider>
    </ReadOnlyProvider>
  );
}
