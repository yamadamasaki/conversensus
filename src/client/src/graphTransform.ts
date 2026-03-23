import type {
  EdgeId,
  GraphEdge,
  GraphNode,
  NodeId,
} from '@conversensus/shared';
import { type Edge, MarkerType, type Node } from '@xyflow/react';

export const DEFAULT_NODE_STYLE = { width: 160, height: 80 };
export const GROUP_PADDING = 20;
export const GROUP_TITLE_HEIGHT = 30;

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

// 子ノードが親ノードの境界をはみ出している場合, 親を拡大して全ての子を包む
export function recalculateParentBounds(nodes: Node[]): Node[] {
  const childrenByParent = new Map<string, Node[]>();
  for (const node of nodes) {
    if (node.parentId) {
      const list = childrenByParent.get(node.parentId) ?? [];
      list.push(node);
      childrenByParent.set(node.parentId, list);
    }
  }

  type Adjustment = {
    dx: number;
    dy: number;
    newWidth: number;
    newHeight: number;
  };
  const adjustments = new Map<string, Adjustment>();

  for (const [parentId, children] of childrenByParent) {
    const parent = nodes.find((n) => n.id === parentId);
    if (!parent) continue;

    const parentWidth = Number(
      parent.style?.width ?? parent.measured?.width ?? 0,
    );
    const parentHeight = Number(
      parent.style?.height ?? parent.measured?.height ?? 0,
    );

    const minChildX = Math.min(...children.map((c) => c.position.x));
    const minChildY = Math.min(...children.map((c) => c.position.y));
    const maxChildX = Math.max(
      ...children.map(
        (c) =>
          c.position.x +
          Number(
            c.measured?.width ?? c.style?.width ?? DEFAULT_NODE_STYLE.width,
          ),
      ),
    );
    const maxChildY = Math.max(
      ...children.map(
        (c) =>
          c.position.y +
          Number(
            c.measured?.height ?? c.style?.height ?? DEFAULT_NODE_STYLE.height,
          ),
      ),
    );

    const leftOverflow = Math.max(0, GROUP_PADDING - minChildX);
    const topOverflow = Math.max(
      0,
      GROUP_TITLE_HEIGHT + GROUP_PADDING - minChildY,
    );
    const newWidth = Math.max(
      parentWidth,
      maxChildX + GROUP_PADDING + leftOverflow,
    );
    const newHeight = Math.max(
      parentHeight,
      maxChildY + GROUP_PADDING + topOverflow,
    );

    if (
      leftOverflow === 0 &&
      topOverflow === 0 &&
      newWidth === parentWidth &&
      newHeight === parentHeight
    )
      continue;

    adjustments.set(parentId, {
      dx: leftOverflow,
      dy: topOverflow,
      newWidth,
      newHeight,
    });
  }

  if (adjustments.size === 0) return nodes;

  return nodes.map((node) => {
    const adj = adjustments.get(node.id);
    if (adj) {
      return {
        ...node,
        position: {
          x: node.position.x - adj.dx,
          y: node.position.y - adj.dy,
        },
        style: { ...node.style, width: adj.newWidth, height: adj.newHeight },
      };
    }
    if (node.parentId) {
      const padj = adjustments.get(node.parentId);
      if (padj) {
        return {
          ...node,
          position: {
            x: node.position.x + padj.dx,
            y: node.position.y + padj.dy,
          },
        };
      }
    }
    return node;
  });
}

export function fromFlowEdges(edges: Edge[]): GraphEdge[] {
  return edges.map((e) => ({
    id: e.id as EdgeId,
    source: e.source as NodeId,
    target: e.target as NodeId,
    label: typeof e.label === 'string' ? e.label : undefined,
  }));
}
