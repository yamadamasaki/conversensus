import type {
  EdgeId,
  GraphEdge,
  GraphNode,
  NodeId,
} from '@conversensus/shared';
import { type Edge, MarkerType, type Node } from '@xyflow/react';

export function toFlowNodes(nodes: GraphNode[]): Node[] {
  return nodes.map((n) => ({
    id: n.id,
    position: n.position,
    data: { label: n.content },
  }));
}

export function toFlowEdges(edges: GraphEdge[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    markerEnd: { type: MarkerType.ArrowClosed },
  }));
}

// React Flow boundary: ids are plain strings, cast to branded types
export function fromFlowNodes(nodes: Node[]): GraphNode[] {
  return nodes.map((n) => ({
    id: n.id as NodeId,
    content: String(n.data.label ?? ''),
    position: n.position,
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
