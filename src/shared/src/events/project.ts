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
  FileId,
  GraphEdge,
  GraphFile,
  GraphNode,
  NodeId,
  NodeLayout,
  Sheet,
  SheetId,
  Style,
} from '../schemas';
import { type Batch, type FileOp, type GraphOp, isFileOp } from './unified';

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

/**
 * Batch を決定論的な順序に整列する: clock → actor → id (Phase 4d-3, 設計 §3.2b)
 *
 * 第 2 キーが `timestamp` (端末のウォールクロック) だと、端末をまたぐ受信では
 * ずれ・巻き戻り・タイムゾーン設定ミスが順序を左右する。`actor` は端末一意の
 * 識別子 (4d-2, `did#deviceId`) なので、端末間でも安定した全順序になる。
 *
 * 単一 actor では退行しない: `LamportClock.tick()` は単調増加なので同一 actor 内で
 * clock は必ず一意であり、第 2 キーは発動しない (回帰テストで固定)。
 */
export function orderBatches(batches: Batch[]): Batch[] {
  return [...batches].sort(
    (a, b) =>
      a.clock - b.clock ||
      a.actor.localeCompare(b.actor) ||
      a.id.localeCompare(b.id),
  );
}

export function projectBatches(batches: Batch[]): ProjectedGraph {
  const g = emptyGraph();
  for (const batch of orderBatches(batches)) {
    for (const op of batch.ops) {
      // file 構造 op は projectFile が畳み込む。content projection では無視する。
      if (isFileOp(op)) continue;
      applyOp(g, op);
    }
  }
  return g;
}

function applyOp(g: ProjectedGraph, op: GraphOp): void {
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

// --- file projection (Batch[] → GraphFile, §3.3) ---

/** シート/ファイル構造の畳み込み状態。単純 LWW (single-actor 前提, critic H2-new) */
type FileStructure = {
  file: { name: string; description?: string };
  /** live シート: id → メタ + createClock (reorder reconcile の tiebreak) */
  sheets: Map<
    SheetId,
    { name: string; description?: string; createClock: number }
  >;
  /** 最新の sheet.reorder の順序 (未指定なら null) */
  order: SheetId[] | null;
};

/** file カテゴリ op を畳み込んで構造 (ファイルメタ・live シート・順序) を導出する */
function foldFileStructure(orderedBatches: Batch[]): FileStructure {
  const s: FileStructure = {
    file: { name: '' },
    sheets: new Map(),
    order: null,
  };
  for (const batch of orderedBatches) {
    for (const op of batch.ops) {
      if (isFileOp(op)) applyFileOp(s, op, batch.clock);
    }
  }
  return s;
}

function applyFileOp(s: FileStructure, op: FileOp, clock: number): void {
  switch (op.kind) {
    case 'sheet.create':
      // add-wins: create でシートを live 化する (再作成は tombstone を解除)
      s.sheets.set(op.target, {
        name: op.name,
        ...(op.description !== undefined && { description: op.description }),
        createClock: clock,
      });
      break;
    case 'sheet.remove':
      // remove-wins: live 集合から外す。content は projection 時に無視される
      s.sheets.delete(op.target);
      break;
    case 'sheet.setName': {
      const meta = s.sheets.get(op.target);
      if (meta) meta.name = op.name;
      break;
    }
    case 'sheet.setDescription': {
      const meta = s.sheets.get(op.target);
      if (meta) {
        if (op.description === undefined) delete meta.description;
        else meta.description = op.description;
      }
      break;
    }
    case 'sheet.reorder':
      s.order = op.order;
      break;
    case 'file.setName':
      s.file.name = op.name;
      break;
    case 'file.setDescription':
      if (op.description === undefined) delete s.file.description;
      else s.file.description = op.description;
      break;
  }
}

/**
 * シート順序を reconcile する (§3.3, レビュー H2)。
 * 最新 reorder の順に並べ、order に無い live シートを createClock 昇順で末尾に追加する。
 * 並行編集対応ではなく「孤立シートを表示から落とさない防御」。
 */
function reconcileOrder(s: FileStructure): SheetId[] {
  const live = s.sheets;
  const ordered = (s.order ?? []).filter((id) => live.has(id));
  const inOrder = new Set(ordered);
  const missing = [...live.keys()]
    .filter((id) => !inOrder.has(id))
    .sort((a, b) => {
      const ca = live.get(a)?.createClock ?? 0;
      const cb = live.get(b)?.createClock ?? 0;
      return ca - cb || (a as string).localeCompare(b as string);
    });
  return [...ordered, ...missing];
}

/**
 * 操作ログ (Batch[]) を `GraphFile` へ射影する (D4 の読み取り経路)。
 * file 構造 op でファイルメタ・シート集合・順序を畳み込み、
 * content batch を sheetId でグルーピングして各シートを `projectBatches` で fold する。
 */
export function projectFile(batches: Batch[], fileId: FileId): GraphFile {
  const ordered = orderBatches(batches);
  const structure = foldFileStructure(ordered);

  // content batch を sheetId でグルーピング (live シートのみ)
  const bySheet = new Map<SheetId, Batch[]>();
  for (const batch of ordered) {
    const sheetId = batch.sheetId;
    if (sheetId === undefined) continue; // file 構造 batch / scope 無し
    if (!structure.sheets.has(sheetId)) continue; // 削除済み・未作成シートの content は無視
    const arr = bySheet.get(sheetId);
    if (arr) arr.push(batch);
    else bySheet.set(sheetId, [batch]);
  }

  const sheets: Sheet[] = reconcileOrder(structure).map((sheetId) => {
    const meta = structure.sheets.get(sheetId);
    const g = projectBatches(bySheet.get(sheetId) ?? []);
    return toSheet(g, {
      id: sheetId,
      name: meta?.name ?? '',
      ...(meta?.description !== undefined && { description: meta.description }),
    });
  });

  return {
    id: fileId,
    name: structure.file.name,
    ...(structure.file.description !== undefined && {
      description: structure.file.description,
    }),
    sheets,
  };
}
