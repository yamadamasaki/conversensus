import type {
  EdgeId,
  EdgeLayout,
  EdgePathType,
  GraphEdge,
  GraphNode,
  NodeId,
  NodeLayout,
} from '@conversensus/shared';

export const LOCAL_USER_ID = 'local';

type Position = { x: number; y: number };
type Size = { width: number; height: number };
type EdgeStyle = { pathType?: EdgePathType } & Record<string, unknown>;

type EventBase = {
  id: string; // crypto.randomUUID()
  timestamp: number; // Date.now()
  userId: string; // 'local' for now
  category: 'structure' | 'content' | 'layout' | 'presentation';
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
export type NodesGroupedEvent = EventBase & {
  category: 'structure';
  type: 'NODES_GROUPED';
  parentId: NodeId;
  parentData: GraphNode;
  parentLayout: NodeLayout;
  children: Array<{
    nodeId: NodeId;
    originalParentId: NodeId | undefined;
    originalPosition: Position;
    newPosition: Position;
  }>;
};
export type NodesUngroupedEvent = EventBase & {
  category: 'structure';
  type: 'NODES_UNGROUPED';
  parentId: NodeId;
  parentData: GraphNode;
  parentLayout: NodeLayout;
  children: Array<{
    nodeId: NodeId;
    originalParentId: NodeId | undefined;
    originalPosition: Position;
    newPosition: Position;
  }>;
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

export type GraphEvent =
  | NodeAddedEvent
  | NodeDeletedEvent
  | NodeReparentedEvent
  | EdgeAddedEvent
  | EdgeDeletedEvent
  | EdgeReconnectedEvent
  | NodesGroupedEvent
  | NodesUngroupedEvent
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
  | EdgeLabelMovedEvent;

export function makeEventBase<C extends GraphEvent['category']>(
  category: C,
): EventBase & { category: C } {
  return {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    userId: LOCAL_USER_ID,
    category,
  };
}
