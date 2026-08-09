/**
 * シート差分の計算 (base → current を `SheetChange[]` として表す)
 *
 * step1 Phase 6 p6-5b で `atproto/branchState.ts` (PDS レコード複製方式) から
 * 切り出した。**op-log 方式ではコミットは差分を持たない** (ログ上のラベル付きオフセット)
 * ため、この関数の役目は UI 表示だけである:
 *
 * - branch 表示中の追加・更新・削除のハイライト (ゴースト表示を含む)
 * - 未コミットの変更 (`pendingChanges`) の算出
 *
 * ## 差分の定義 (ANA-119/120/124, 2026-08-09 確定)
 *
 * 差分は **「基準と現在で値が実際に違うもの」** である (net 比較)。したがって
 * **編集して同じ値に戻した場合 (undo を含む) は差分に出ない**。
 *
 * 設計 (`step1-refinement-ana119-versioning.md` D1) は「op 区間から候補 target を集め、
 * その値を基準と比べる」という 2 段構えで書かれている。ここで op 区間を引かず
 * base / current の Sheet を直接比べているのは、
 *
 * - `current` は op-log の projection ではなく **編集中のメモリ上の Sheet** であり、
 *   op-log には tap が非同期に書く。op 区間を正典にするとハイライトが 1 flush 遅れる
 * - 結果は同じになる — projection は op で決まるので、「区間の op に触れられていない
 *   target」は値も変わらない。op 区間は候補集合を絞る最適化にすぎない
 *
 * ため。**比較するフィールドは op の語彙 (`unified.ts` の `OP_CATEGORY`) に対応させる**:
 *
 * | カテゴリ | node | edge |
 * |---|---|---|
 * | content | `content` / `properties` | `label` / `properties` |
 * | structure | 存在 / `nodeType` / `parentId` | 存在 / `source` / `target` |
 * | layout | `x` / `y` / `width` / `height` | `sourceHandle` / `targetHandle` / `pathType` |
 * | presentation | **比較しない** | **比較しない** |
 *
 * presentation (`node.setStyle` / `edge.setStyle` / `edge.setLabelOffset`) を外すのは、
 * それがローカル限定で remote にも出ない (`isSyncable` が false) ためである。
 * `toSheet` も presentation を Sheet に載せない。
 */

import type {
  CommitOperation,
  EdgeLayout,
  GraphEdge,
  GraphNode,
  NodeLayout,
  Sheet,
} from '@conversensus/shared';
import { DEFAULT_EDGE_PATH_TYPE, DEFAULT_NODE_STYLE } from '../graphTransform';

/** 変更が属するカテゴリ。op の `OP_CATEGORY` と対応する (presentation は差分に出さない) */
export type ChangeCategory = 'content' | 'structure' | 'layout';

/** UI 表示用の 1 件の変更。`op` は表示のための要約で、コミットには焼き込まれない */
export type SheetChange = {
  op: CommitOperation;
  /**
   * この変更に寄与したカテゴリ。`layout` だけなら「動かした / 大きさを変えた」だけの変更で、
   * commit ダイアログはこれを内訳として見せる。追加・削除は常に `structure`。
   */
  categories: ChangeCategory[];
};

// --- 正規化 -----------------------------------------------------------------
//
// projection 由来の Sheet と、React Flow を往復した編集中の Sheet は、
// **「省略」と「既定値の明示」が食い違う**。例えば layout を持たないノードは
// projection では x/y が undefined だが、`toFlowNodes` → `fromFlowNodes` を通ると
// x=0, width=160 が明示的に入る。素朴に比べると全ノードが「変更」になってしまうので、
// 両方を「画面に見える形」へ揃えてから比べる。

/**
 * op-log は layout 値を整数へ丸めてから記録する (`toUnified.ts` の `roundLayoutValue`)。
 * 同じ丸めをここでも掛けないと、**op になった時点で消える差** (0.4px のずれ) が
 * 差分として出てしまう。
 */
function roundLayoutValue<T extends number | string | undefined>(value: T): T {
  return (typeof value === 'number' ? Math.round(value) : value) as T;
}

type ViewNodeLayout = {
  x: number;
  y: number;
  width: number | string;
  height: number | string;
};

function viewNodeLayout(layout: NodeLayout | undefined): ViewNodeLayout {
  return {
    x: Math.round(layout?.x ?? 0),
    y: Math.round(layout?.y ?? 0),
    width: roundLayoutValue(layout?.width) ?? DEFAULT_NODE_STYLE.width,
    height: roundLayoutValue(layout?.height) ?? DEFAULT_NODE_STYLE.height,
  };
}

type ViewEdgeLayout = {
  sourceHandle: string | undefined;
  targetHandle: string | undefined;
  pathType: string;
};

function viewEdgeLayout(layout: EdgeLayout | undefined): ViewEdgeLayout {
  return {
    sourceHandle: layout?.sourceHandle,
    targetHandle: layout?.targetHandle,
    // 明示されていないエッジも画面では既定の経路で描かれる (`toFlowEdges`)
    pathType: layout?.pathType ?? DEFAULT_EDGE_PATH_TYPE,
  };
}

/**
 * properties の比較。キーの順序に左右されないよう、キーを揃えてから値ごとに比べる。
 * `undefined` と `{}` は同じ (どちらも「プロパティが無い」) とみなす。
 */
function sameProperties(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  const aKeys = Object.keys(a ?? {}).sort();
  const bKeys = Object.keys(b ?? {}).sort();
  if (aKeys.length !== bKeys.length) return false;
  if (aKeys.some((key, i) => key !== bKeys[i])) return false;
  return aKeys.every(
    (key) => JSON.stringify(a?.[key]) === JSON.stringify(b?.[key]),
  );
}

// --- カテゴリごとの比較 -------------------------------------------------------

function nodeContentChanged(base: GraphNode, current: GraphNode): boolean {
  return (
    base.content !== current.content ||
    !sameProperties(base.properties, current.properties)
  );
}

function nodeStructureChanged(base: GraphNode, current: GraphNode): boolean {
  return (
    base.nodeType !== current.nodeType || base.parentId !== current.parentId
  );
}

function nodeLayoutChanged(
  base: NodeLayout | undefined,
  current: NodeLayout | undefined,
): boolean {
  const b = viewNodeLayout(base);
  const c = viewNodeLayout(current);
  return (
    b.x !== c.x || b.y !== c.y || b.width !== c.width || b.height !== c.height
  );
}

function edgeContentChanged(base: GraphEdge, current: GraphEdge): boolean {
  return (
    base.label !== current.label ||
    !sameProperties(base.properties, current.properties)
  );
}

/** 付け替え (`onReconnect`) は端点が変わるので structure の変更である */
function edgeStructureChanged(base: GraphEdge, current: GraphEdge): boolean {
  return base.source !== current.source || base.target !== current.target;
}

function edgeLayoutChanged(
  base: EdgeLayout | undefined,
  current: EdgeLayout | undefined,
): boolean {
  const b = viewEdgeLayout(base);
  const c = viewEdgeLayout(current);
  return (
    b.sourceHandle !== c.sourceHandle ||
    b.targetHandle !== c.targetHandle ||
    b.pathType !== c.pathType
  );
}

// --- 本体 -------------------------------------------------------------------

const byNodeId = (layouts: NodeLayout[] | undefined) =>
  new Map((layouts ?? []).map((l) => [l.nodeId as string, l]));

const byEdgeId = (layouts: EdgeLayout[] | undefined) =>
  new Map((layouts ?? []).map((l) => [l.edgeId as string, l]));

export function computeSheetChanges(
  base: Sheet,
  current: Sheet,
): SheetChange[] {
  const changes: SheetChange[] = [];

  const baseNodeMap = new Map(base.nodes.map((n) => [n.id as string, n]));
  const currentNodeMap = new Map(current.nodes.map((n) => [n.id as string, n]));
  const baseEdgeMap = new Map(base.edges.map((e) => [e.id as string, e]));
  const currentEdgeMap = new Map(current.edges.map((e) => [e.id as string, e]));
  const baseNodeLayouts = byNodeId(base.layouts);
  const currentNodeLayouts = byNodeId(current.layouts);
  const baseEdgeLayouts = byEdgeId(base.edgeLayouts);
  const currentEdgeLayouts = byEdgeId(current.edgeLayouts);

  for (const node of current.nodes) {
    if (!baseNodeMap.has(node.id)) {
      changes.push({
        op: {
          op: 'node.add',
          nodeId: node.id,
          content: node.content,
          ...(node.properties && { properties: node.properties }),
          ...(node.nodeType && { nodeType: node.nodeType }),
          ...(node.parentId !== undefined && { parentId: node.parentId }),
        },
        categories: ['structure'],
      });
    }
  }

  for (const node of current.nodes) {
    const baseNode = baseNodeMap.get(node.id);
    if (!baseNode) continue;
    const categories: ChangeCategory[] = [];
    if (nodeContentChanged(baseNode, node)) categories.push('content');
    if (nodeStructureChanged(baseNode, node)) categories.push('structure');
    if (
      nodeLayoutChanged(
        baseNodeLayouts.get(node.id),
        currentNodeLayouts.get(node.id),
      )
    )
      categories.push('layout');
    if (categories.length === 0) continue;
    changes.push({
      op: {
        op: 'node.update',
        nodeId: node.id,
        content: node.content,
        ...(node.properties && { properties: node.properties }),
        ...(node.parentId !== undefined && { parentId: node.parentId }),
      },
      categories,
    });
  }

  for (const node of base.nodes) {
    if (!currentNodeMap.has(node.id)) {
      changes.push({
        op: { op: 'node.remove', nodeId: node.id },
        categories: ['structure'],
      });
    }
  }

  for (const edge of current.edges) {
    if (!baseEdgeMap.has(edge.id)) {
      changes.push({
        op: {
          op: 'edge.add',
          edgeId: edge.id,
          sourceId: edge.source,
          targetId: edge.target,
          ...(edge.label && { label: edge.label }),
          ...(edge.properties && { properties: edge.properties }),
        },
        categories: ['structure'],
      });
    }
  }

  for (const edge of current.edges) {
    const baseEdge = baseEdgeMap.get(edge.id);
    if (!baseEdge) continue;
    const categories: ChangeCategory[] = [];
    if (edgeContentChanged(baseEdge, edge)) categories.push('content');
    if (edgeStructureChanged(baseEdge, edge)) categories.push('structure');
    if (
      edgeLayoutChanged(
        baseEdgeLayouts.get(edge.id),
        currentEdgeLayouts.get(edge.id),
      )
    )
      categories.push('layout');
    if (categories.length === 0) continue;
    changes.push({
      op: {
        op: 'edge.update',
        edgeId: edge.id,
        ...(edge.label !== undefined && { label: edge.label }),
        ...(edge.properties && { properties: edge.properties }),
      },
      categories,
    });
  }

  for (const edge of base.edges) {
    if (!currentEdgeMap.has(edge.id)) {
      changes.push({
        op: { op: 'edge.remove', edgeId: edge.id },
        categories: ['structure'],
      });
    }
  }

  return changes;
}

/** `SheetChange[]` から op だけを取り出す。件数や種別の集計に使う */
export function computeOperations(
  base: Sheet,
  current: Sheet,
): CommitOperation[] {
  return computeSheetChanges(base, current).map((c) => c.op);
}

/** layout だけが変わった変更 = 「動かした / 大きさを変えた」だけ */
export function isLayoutOnly(change: SheetChange): boolean {
  return change.categories.length === 1 && change.categories[0] === 'layout';
}
