import type {
  EdgeId,
  EdgeLayout,
  EdgePathType,
  GraphEdge,
  GraphNode,
  NodeId,
  NodeLayout,
  SheetId,
} from '@conversensus/shared';

type Position = { x: number; y: number };
type Size = { width: number; height: number };
type EdgeStyle = { pathType?: EdgePathType } & Record<string, unknown>;

type EventBase = {
  id: string; // crypto.randomUUID()
  timestamp: number; // Date.now()
  category: 'structure' | 'content' | 'layout' | 'presentation' | 'file';
};

// --- Structure ---
export type NodeAddedEvent = EventBase & {
  category: 'structure';
  type: 'NODE_ADDED';
  nodeId: NodeId;
  data: GraphNode;
  layout?: NodeLayout;
};
export type NodeDeletedEvent = EventBase & {
  category: 'structure';
  type: 'NODE_DELETED';
  nodeId: NodeId;
  data: GraphNode;
  layout?: NodeLayout;
};
export type EdgeAddedEvent = EventBase & {
  category: 'structure';
  type: 'EDGE_ADDED';
  edgeId: EdgeId;
  data: GraphEdge;
  edgeLayout?: EdgeLayout;
};
export type EdgeDeletedEvent = EventBase & {
  category: 'structure';
  type: 'EDGE_DELETED';
  edgeId: EdgeId;
  data: GraphEdge;
  edgeLayout?: EdgeLayout;
};
export type EdgeReconnectedEvent = EventBase & {
  category: 'structure';
  type: 'EDGE_RECONNECTED';
  edgeId: EdgeId;
  from: {
    source: NodeId;
    target: NodeId;
    sourceHandle?: string;
    targetHandle?: string;
  };
  to: {
    source: NodeId;
    target: NodeId;
    sourceHandle?: string;
    targetHandle?: string;
  };
};
export type NodeReparentedEvent = EventBase & {
  category: 'structure';
  type: 'NODE_REPARENTED';
  nodeId: NodeId;
  oldParentId: NodeId | undefined;
  newParentId: NodeId | undefined;
  oldPosition: Position;
  newPosition: Position;
};
/**
 * グループ化 / 解除で動く子ノードの配置。
 *
 * `outer*` はグループの**外**にいるときの状態 (グループ化する前、解除した後) を表す。
 * `outerPosition` は `outerParentId` から見た相対座標で、親が無ければ絶対座標。
 * `innerPosition` はグループの子としての位置 (グループから見た相対座標)。
 *
 * グループ化はこの子を outer → inner へ、解除は inner → outer へ動かす。
 * どちらの向きにも同じ組を使うので、名前は操作の向きに依存しない。
 */
export type GroupChildPlacement = {
  nodeId: NodeId;
  outerParentId: NodeId | undefined;
  outerPosition: Position;
  innerPosition: Position;
};
export type NodesGroupedEvent = EventBase & {
  category: 'structure';
  type: 'NODES_GROUPED';
  parentId: NodeId;
  parentData: GraphNode;
  parentLayout: NodeLayout;
  children: GroupChildPlacement[];
};
export type NodesUngroupedEvent = EventBase & {
  category: 'structure';
  type: 'NODES_UNGROUPED';
  parentId: NodeId;
  parentData: GraphNode;
  parentLayout: NodeLayout;
  children: GroupChildPlacement[];
};
/**
 * 選択したノードとその子孫、および巻き込まれるエッジをまとめて削除する。
 *
 * 1 ノード 1 イベントにしないのは、undo を 1 回で戻すためである。
 * グループとその子を別々のイベントで消すと、undo の途中で「親がまだ復元されて
 * いないのに子だけ居る」状態 (孤児) が現れてしまう。
 */
export type NodesDeletedEvent = EventBase & {
  category: 'structure';
  type: 'NODES_DELETED';
  nodeIds: NodeId[];
  edgeIds: EdgeId[];
  nodes: GraphNode[];
  layouts: NodeLayout[];
  edges: GraphEdge[];
  edgeLayouts: EdgeLayout[];
};
/** `NODES_DELETED` の逆。削除したノード・エッジを位置ごと復元する */
export type NodesRestoredEvent = EventBase & {
  category: 'structure';
  type: 'NODES_RESTORED';
  nodes: GraphNode[];
  layouts: NodeLayout[];
  edges: GraphEdge[];
  edgeLayouts: EdgeLayout[];
};
export type NodesPastedEvent = EventBase & {
  category: 'structure';
  type: 'NODES_PASTED';
  nodes: GraphNode[];
  layouts: NodeLayout[];
  edges: GraphEdge[];
  edgeLayouts: EdgeLayout[];
};
export type NodesPastedUndoEvent = EventBase & {
  category: 'structure';
  type: 'NODES_PASTED_UNDO';
  nodeIds: NodeId[];
  edgeIds: EdgeId[];
  nodes: GraphNode[];
  layouts: NodeLayout[];
  edges: GraphEdge[];
  edgeLayouts: EdgeLayout[];
};

// --- Content ---
export type NodeRelabeledEvent = EventBase & {
  category: 'content';
  type: 'NODE_RELABELED';
  nodeId: NodeId;
  from: string;
  to: string;
};
export type EdgeRelabeledEvent = EventBase & {
  category: 'content';
  type: 'EDGE_RELABELED';
  edgeId: EdgeId;
  from: string;
  to: string;
};
export type NodePropertiesChangedEvent = EventBase & {
  category: 'content';
  type: 'NODE_PROPERTIES_CHANGED';
  nodeId: NodeId;
  from: Record<string, unknown>;
  to: Record<string, unknown>;
};
export type EdgePropertiesChangedEvent = EventBase & {
  category: 'content';
  type: 'EDGE_PROPERTIES_CHANGED';
  edgeId: EdgeId;
  from: Record<string, unknown>;
  to: Record<string, unknown>;
};

// --- Layout ---
export type NodeMovedEvent = EventBase & {
  category: 'layout';
  type: 'NODE_MOVED';
  nodeId: NodeId;
  from: Position;
  to: Position;
};
export type NodeResizedEvent = EventBase & {
  category: 'layout';
  type: 'NODE_RESIZED';
  nodeId: NodeId;
  from: Size;
  to: Size;
};

// --- Presentation ---
export type EdgeStyleChangedEvent = EventBase & {
  category: 'presentation';
  type: 'EDGE_STYLE_CHANGED';
  edgeId: EdgeId;
  from: Partial<EdgeStyle>;
  to: Partial<EdgeStyle>;
};
export type NodeStyleChangedEvent = EventBase & {
  category: 'presentation';
  type: 'NODE_STYLE_CHANGED';
  nodeId: NodeId;
  from: NodeLayout;
  to: NodeLayout;
};
export type EdgeLabelMovedEvent = EventBase & {
  category: 'presentation';
  type: 'EDGE_LABEL_MOVED';
  edgeId: EdgeId;
  from: { offsetX: number; offsetY: number };
  to: { offsetX: number; offsetY: number };
};

// --- File / Sheet structure (op-log 化, W3c1) ---
// これらは undo を通さず syncRecord (tap.record) で直接 op-log へ流す。
// dispatch (useEventStore) を経由しないため applyEvent/invertEvent は関与しない。
export type SheetCreatedEvent = EventBase & {
  category: 'file';
  type: 'SHEET_CREATED';
  sheetId: SheetId;
  name: string;
  description?: string;
};
export type SheetRemovedEvent = EventBase & {
  category: 'file';
  type: 'SHEET_REMOVED';
  sheetId: SheetId;
};
export type SheetRenamedEvent = EventBase & {
  category: 'file';
  type: 'SHEET_RENAMED';
  sheetId: SheetId;
  name: string;
};
export type SheetDescribedEvent = EventBase & {
  category: 'file';
  type: 'SHEET_DESCRIBED';
  sheetId: SheetId;
  description?: string;
};
export type FileRenamedEvent = EventBase & {
  category: 'file';
  type: 'FILE_RENAMED';
  name: string;
};
export type FileDescribedEvent = EventBase & {
  category: 'file';
  type: 'FILE_DESCRIBED';
  description?: string;
};

export type GraphEvent =
  | NodeAddedEvent
  | NodeDeletedEvent
  | NodeReparentedEvent
  | EdgeAddedEvent
  | EdgeDeletedEvent
  | EdgeReconnectedEvent
  | NodesGroupedEvent
  | NodesUngroupedEvent
  | NodesDeletedEvent
  | NodesRestoredEvent
  | NodesPastedEvent
  | NodesPastedUndoEvent
  | NodeRelabeledEvent
  | EdgeRelabeledEvent
  | NodePropertiesChangedEvent
  | EdgePropertiesChangedEvent
  | NodeMovedEvent
  | NodeResizedEvent
  | EdgeStyleChangedEvent
  | NodeStyleChangedEvent
  | EdgeLabelMovedEvent
  | SheetCreatedEvent
  | SheetRemovedEvent
  | SheetRenamedEvent
  | SheetDescribedEvent
  | FileRenamedEvent
  | FileDescribedEvent;

export function makeEventBase<C extends GraphEvent['category']>(
  category: C,
): EventBase & { category: C } {
  return {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    category,
  };
}
