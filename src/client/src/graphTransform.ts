import type { GraphEdge, GraphNode } from '@conversensus/shared';
import type { Edge, Node } from '@xyflow/react';

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
  }));
}

export function fromFlowNodes(nodes: Node[]): GraphNode[] {
  return nodes.map((n) => ({
    id: n.id,
    content: String(n.data.label ?? ''),
    position: n.position,
  }));
}

export function fromFlowEdges(edges: Edge[]): GraphEdge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: typeof e.label === 'string' ? e.label : undefined,
  }));
}
