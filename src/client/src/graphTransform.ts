import type {
  EdgeId,
  GraphEdge,
  GraphNode,
  NodeId,
} from '@conversensus/shared';
import { type Edge, MarkerType, type Node } from '@xyflow/react';

export const DEFAULT_NODE_STYLE = { width: 160, height: 80 };

export function toFlowNodes(nodes: GraphNode[]): Node[] {
  return nodes.map((n) => ({
    id: n.id,
    position: {
      x: typeof n.style?.x === 'number' ? n.style.x : 0,
      y: typeof n.style?.y === 'number' ? n.style.y : 0,
    },
    data: { label: n.content },
    type: n.style?.nodeType === 'group' ? 'groupNode' : 'editableNode',
    parentId: n.parentId,
    style: n.style ?? DEFAULT_NODE_STYLE,
  }));
}

export function toFlowEdges(edges: GraphEdge[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    type: 'editableLabel',
    markerEnd: { type: MarkerType.ArrowClosed },
  }));
}

// React Flow boundary: ids are plain strings, cast to branded types
export function fromFlowNodes(nodes: Node[]): GraphNode[] {
  return nodes.map((n) => ({
    id: n.id as NodeId,
    content: String(n.data.label ?? ''),
    parentId: n.parentId as NodeId | undefined,
    style: {
      x: n.position.x,
      y: n.position.y,
      width: n.style?.width,
      height: n.style?.height,
      ...(n.type === 'groupNode' ? { nodeType: 'group' } : {}),
    },
  }));
}

export function fromFlowEdges(edges: Edge[]): GraphEdge[] {
  return edges.map((e) => ({
    id: e.id as EdgeId,
    source: e.source as NodeId,
    target: e.target as NodeId,
    label: typeof e.label === 'string' ? e.label : undefined,
  }));
}
