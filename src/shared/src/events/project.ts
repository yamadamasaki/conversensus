/**
 * projection: 統一イベント (Batch[]) → グラフ状態 (導出ビュー)
 *
 * step1 §4 の「集約は projection」を実現する fold。現行 `applyEvent` の統一版。
 * Batch を (clock, timestamp, id) 昇順に整列し、Batch 内の Op を配列順に畳み込む。
 * → 決定論的な LWW (clock 大が後勝ち) が成立する。
 */

import type {
  EdgeId,
  EdgeLayout,
  GraphEdge,
  GraphNode,
  NodeId,
  NodeLayout,
  Sheet,
  SheetId,
  Style,
} from '../schemas';
import type { Batch, Op } from './unified';

export type ProjectedGraph = {
  nodes: Map<NodeId, GraphNode>;
  edges: Map<EdgeId, GraphEdge>;
  nodeLayouts: Map<NodeId, NodeLayout>;
  edgeLayouts: Map<EdgeId, EdgeLayout>;
  /** presentation はローカル限定 (同期しない)。target ごとの style / label offset */
  presentation: Map<string, Style>;
};

function emptyGraph(): ProjectedGraph {
  return {
    nodes: new Map(),
    edges: new Map(),
    nodeLayouts: new Map(),
    edgeLayouts: new Map(),
    presentation: new Map(),
  };
}

/** Batch を決定論的な順序に整列する: clock → timestamp → id */
function orderBatches(batches: Batch[]): Batch[] {
  return [...batches].sort(
    (a, b) =>
      a.clock - b.clock ||
      a.timestamp - b.timestamp ||
      a.id.localeCompare(b.id),
  );
}

export function projectBatches(batches: Batch[]): ProjectedGraph {
  const g = emptyGraph();
  for (const batch of orderBatches(batches)) {
    for (const op of batch.ops) {
      applyOp(g, op);
    }
  }
  return g;
}

function applyOp(g: ProjectedGraph, op: Op): void {
  switch (op.kind) {
    case 'node.add':
      g.nodes.set(op.target, {
        id: op.target,
        content: op.content,
        ...(op.properties && { properties: op.properties }),
        ...(op.nodeType && { nodeType: op.nodeType }),
        ...(op.parentId !== undefined && { parentId: op.parentId }),
      });
      break;
    case 'node.remove': {
      g.nodes.delete(op.target);
      g.nodeLayouts.delete(op.target);
      // 接続エッジもカスケード削除する (applyEvent NODE_DELETED と同じ挙動)
      for (const [edgeId, edge] of g.edges) {
        if (edge.source === op.target || edge.target === op.target) {
          g.edges.delete(edgeId);
          g.edgeLayouts.delete(edgeId);
        }
      }
      break;
    }
    case 'node.setParent': {
      const node = g.nodes.get(op.target);
      if (node) {
        if (op.parentId === undefined) delete node.parentId;
        else node.parentId = op.parentId;
      }
      break;
    }
    case 'edge.add':
      g.edges.set(op.target, {
        id: op.target,
        source: op.source,
        target: op.dest,
        ...(op.label !== undefined && { label: op.label }),
        ...(op.properties && { properties: op.properties }),
      });
      break;
    case 'edge.remove':
      g.edges.delete(op.target);
      g.edgeLayouts.delete(op.target);
      break;
    case 'edge.reconnect': {
      const edge = g.edges.get(op.target);
      if (edge) {
        edge.source = op.source;
        edge.target = op.dest;
      }
      break;
    }
    case 'node.setContent': {
      const node = g.nodes.get(op.target);
      if (node) node.content = op.content;
      break;
    }
    case 'node.setProperties': {
      const node = g.nodes.get(op.target);
      if (node) node.properties = op.properties;
      break;
    }
    case 'edge.setLabel': {
      const edge = g.edges.get(op.target);
      if (edge) edge.label = op.label;
      break;
    }
    case 'edge.setProperties': {
      const edge = g.edges.get(op.target);
      if (edge) edge.properties = op.properties;
      break;
    }
    case 'node.setLayout': {
      // 部分更新: 移動 (x/y) と リサイズ (width/height) を独立に畳み込む
      const prev = g.nodeLayouts.get(op.target) ?? { nodeId: op.target };
      g.nodeLayouts.set(op.target, {
        ...prev,
        ...(op.x !== undefined && { x: op.x }),
        ...(op.y !== undefined && { y: op.y }),
        ...(op.width !== undefined && { width: op.width }),
        ...(op.height !== undefined && { height: op.height }),
      });
      break;
    }
    case 'edge.setLayout': {
      const prev = g.edgeLayouts.get(op.target) ?? { edgeId: op.target };
      g.edgeLayouts.set(op.target, {
        ...prev,
        ...(op.sourceHandle !== undefined && { sourceHandle: op.sourceHandle }),
        ...(op.targetHandle !== undefined && { targetHandle: op.targetHandle }),
        ...(op.pathType !== undefined && { pathType: op.pathType }),
      });
      break;
    }
    case 'node.setStyle':
    case 'edge.setStyle': {
      const prev = g.presentation.get(op.target) ?? {};
      g.presentation.set(op.target, { ...prev, ...op.style });
      break;
    }
    case 'edge.setLabelOffset': {
      const prev = g.presentation.get(op.target) ?? {};
      g.presentation.set(op.target, {
        ...prev,
        labelOffsetX: op.offsetX,
        labelOffsetY: op.offsetY,
      });
      break;
    }
  }
}

/** projection を既存の `Sheet` 形式へ変換する (エディタ・エクスポート・入出力の受け口) */
export function toSheet(
  g: ProjectedGraph,
  meta: { id: SheetId; name: string; description?: string },
): Sheet {
  return {
    id: meta.id,
    name: meta.name,
    ...(meta.description !== undefined && { description: meta.description }),
    nodes: [...g.nodes.values()],
    edges: [...g.edges.values()],
    layouts: [...g.nodeLayouts.values()],
    edgeLayouts: [...g.edgeLayouts.values()],
  };
}
