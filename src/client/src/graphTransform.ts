import type {
  EdgeId,
  EdgeLayout,
  EdgePathType,
  GraphEdge,
  GraphNode,
  NodeId,
  NodeLayout,
} from '@conversensus/shared';
import { type Edge, MarkerType, type Node } from '@xyflow/react';

export const DEFAULT_NODE_STYLE = { width: 160, height: 80 };
export const GROUP_PADDING = 20;
export const GROUP_TITLE_HEIGHT = 30;

export function toFlowNodes(
  nodes: GraphNode[],
  layouts: NodeLayout[] = [],
  conflictedNodeIds?: Set<string>,
): Node[] {
  const layoutMap = new Map(layouts.map((l) => [l.nodeId as string, l]));
  return nodes.map((n) => {
    const layout = layoutMap.get(n.id) ?? {
      nodeId: n.id as NodeId,
      x: 0,
      y: 0,
    };
    return {
      id: n.id,
      position: {
        x: layout.x ?? 0,
        y: layout.y ?? 0,
      },
      data: {
        label: n.content,
        conflicted: conflictedNodeIds?.has(n.id) ?? false,
      },
      type: layout.nodeType === 'group' ? 'groupNode' : 'editableNode',
      parentId: layout.parentId,
      style:
        layout.width !== undefined || layout.height !== undefined
          ? { width: layout.width, height: layout.height }
          : DEFAULT_NODE_STYLE,
    };
  });
}

export function toFlowEdges(
  edges: GraphEdge[],
  edgeLayouts: EdgeLayout[] = [],
  conflictedEdgeIds?: Set<string>,
): Edge[] {
  const layoutMap = new Map(edgeLayouts.map((l) => [l.edgeId as string, l]));
  return edges.map((e) => {
    const layout = layoutMap.get(e.id);
    const conflicted = conflictedEdgeIds?.has(e.id) ?? false;
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: layout?.sourceHandle,
      targetHandle: layout?.targetHandle,
      label: e.label,
      type: 'editableLabel',
      markerEnd: { type: MarkerType.ArrowClosed },
      style: conflicted ? { stroke: '#f97316', strokeWidth: 3 } : undefined,
      data: {
        pathType: layout?.pathType ?? 'bezier',
        labelOffsetX: layout?.labelOffsetX ?? 0,
        labelOffsetY: layout?.labelOffsetY ?? 0,
        conflicted,
      },
    };
  });
}

// React Flow boundary: ids are plain strings, cast to branded types
export function fromFlowNodes(nodes: Node[]): {
  nodes: GraphNode[];
  layouts: NodeLayout[];
} {
  const graphNodes: GraphNode[] = nodes.map((n) => ({
    id: n.id as NodeId,
    content: String(n.data.label ?? ''),
  }));

  const layouts: NodeLayout[] = nodes.map((n) => ({
    nodeId: n.id as NodeId,
    x: n.position.x,
    y: n.position.y,
    width: n.style?.width as number | string | undefined,
    height: n.style?.height as number | string | undefined,
    ...(n.type === 'groupNode' ? { nodeType: 'group' as const } : {}),
    ...(n.parentId ? { parentId: n.parentId as NodeId } : {}),
  }));

  return { nodes: graphNodes, layouts };
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

// 選択ノードと、それら間のエッジを収集する
// グループノードが選択されている場合, 子孫ノードも再帰的に含める
export function collectCopyData(
  nodes: Node[],
  edges: Edge[],
): { nodes: Node[]; edges: Edge[] } {
  const selected = nodes.filter((n) => n.selected);
  if (selected.length === 0) return { nodes: [], edges: [] };

  const includedIds = new Set(selected.map((n) => n.id));

  const addDescendants = (parentId: string) => {
    for (const node of nodes) {
      if (node.parentId === parentId && !includedIds.has(node.id)) {
        includedIds.add(node.id);
        addDescendants(node.id);
      }
    }
  };

  for (const node of selected) {
    if (node.type === 'groupNode') {
      addDescendants(node.id);
    }
  }

  const includedNodes = nodes.filter((n) => includedIds.has(n.id));
  const relatedEdges = edges.filter(
    (e) => includedIds.has(e.source) && includedIds.has(e.target),
  );
  return { nodes: includedNodes, edges: relatedEdges };
}

// クリップボードのノード/エッジから新しい UUID・オフセット位置でペーストデータを生成する
export function buildPastedData(
  clipboard: { nodes: Node[]; edges: Edge[] },
  offset: number,
): { nodes: Node[]; edges: Edge[] } {
  const idMap = new Map<string, string>(
    clipboard.nodes.map((n) => [n.id, crypto.randomUUID()]),
  );

  const mappedNodes: Node[] = clipboard.nodes.map((n) => {
    const newParentId = n.parentId ? idMap.get(n.parentId) : undefined;
    // 親がコピーセット内にある子ノードは相対座標のままオフセット不要
    const applyOffset = !newParentId;
    return {
      ...n,
      id: idMap.get(n.id) as string,
      parentId: newParentId,
      selected: true,
      position: {
        x: n.position.x + (applyOffset ? offset : 0),
        y: n.position.y + (applyOffset ? offset : 0),
      },
    };
  });

  // React Flow は親ノードを子ノードより前に並べる必要があるため,
  // parentId が解決済みの順にトポロジカルソートする
  const sorted: Node[] = [];
  const remaining = [...mappedNodes];
  const addedIds = new Set<string>();
  while (remaining.length > 0) {
    const idx = remaining.findIndex(
      (n) => !n.parentId || addedIds.has(n.parentId),
    );
    if (idx === -1) break; // 循環がある場合は残りをそのまま追加
    const [node] = remaining.splice(idx, 1);
    sorted.push(node);
    addedIds.add(node.id);
  }
  sorted.push(...remaining);

  const edges: Edge[] = clipboard.edges.map((e) => ({
    ...e,
    id: crypto.randomUUID(),
    source: idMap.get(e.source) as string,
    target: idMap.get(e.target) as string,
  }));

  return { nodes: sorted, edges };
}

export function fromFlowEdges(edges: Edge[]): {
  edges: GraphEdge[];
  edgeLayouts: EdgeLayout[];
} {
  const graphEdges: GraphEdge[] = edges.map((e) => ({
    id: e.id as EdgeId,
    source: e.source as NodeId,
    target: e.target as NodeId,
    label: typeof e.label === 'string' ? e.label : undefined,
  }));

  const edgeLayouts: EdgeLayout[] = edges.map((e) => ({
    edgeId: e.id as EdgeId,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
    pathType: (e.data?.pathType as EdgePathType | undefined) ?? undefined,
    labelOffsetX: (e.data?.labelOffsetX as number | undefined) || undefined,
    labelOffsetY: (e.data?.labelOffsetY as number | undefined) || undefined,
  }));

  return { edges: graphEdges, edgeLayouts };
}
