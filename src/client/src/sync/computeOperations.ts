/**
 * シート差分の計算 (base → current を `CommitOperation[]` として表す)
 *
 * step1 Phase 6 p6-5b で `atproto/branchState.ts` (PDS レコード複製方式) から
 * 切り出した。**op-log 方式ではコミットは差分を持たない** (ログ上のラベル付きオフセット)
 * ため、この関数の役目は UI 表示だけに絞られている:
 *
 * - branch 表示中の追加・更新・削除のハイライト (ゴースト表示を含む)
 * - 未コミットの変更件数 (`pendingOps`) の算出
 *
 * layout の変更は含めない (滑らかな変更は commit の対象外)。
 */

import type { CommitOperation, Sheet } from '@conversensus/shared';

export function computeOperations(
  base: Sheet,
  current: Sheet,
): CommitOperation[] {
  const ops: CommitOperation[] = [];

  const baseNodeMap = new Map(base.nodes.map((n) => [n.id, n]));
  const currentNodeMap = new Map(current.nodes.map((n) => [n.id, n]));
  const baseEdgeMap = new Map(base.edges.map((e) => [e.id, e]));
  const currentEdgeMap = new Map(current.edges.map((e) => [e.id, e]));

  for (const node of current.nodes) {
    if (!baseNodeMap.has(node.id)) {
      ops.push({
        op: 'node.add',
        nodeId: node.id,
        content: node.content,
        ...(node.properties && { properties: node.properties }),
        ...(node.nodeType && { nodeType: node.nodeType }),
        ...(node.parentId !== undefined && { parentId: node.parentId }),
      });
    }
  }

  for (const node of current.nodes) {
    const baseNode = baseNodeMap.get(node.id);
    if (
      baseNode &&
      (baseNode.content !== node.content ||
        JSON.stringify(baseNode.properties) !==
          JSON.stringify(node.properties) ||
        baseNode.nodeType !== node.nodeType ||
        baseNode.parentId !== node.parentId)
    ) {
      ops.push({
        op: 'node.update',
        nodeId: node.id,
        content: node.content,
        ...(node.properties && { properties: node.properties }),
        ...(node.parentId !== undefined && { parentId: node.parentId }),
      });
    }
  }

  for (const node of base.nodes) {
    if (!currentNodeMap.has(node.id)) {
      ops.push({ op: 'node.remove', nodeId: node.id });
    }
  }

  for (const edge of current.edges) {
    if (!baseEdgeMap.has(edge.id)) {
      ops.push({
        op: 'edge.add',
        edgeId: edge.id,
        sourceId: edge.source,
        targetId: edge.target,
        ...(edge.label && { label: edge.label }),
        ...(edge.properties && { properties: edge.properties }),
      });
    }
  }

  for (const edge of current.edges) {
    const baseEdge = baseEdgeMap.get(edge.id);
    if (
      baseEdge &&
      (baseEdge.label !== edge.label ||
        JSON.stringify(baseEdge.properties) !== JSON.stringify(edge.properties))
    ) {
      ops.push({
        op: 'edge.update',
        edgeId: edge.id,
        ...(edge.label !== undefined && { label: edge.label }),
        ...(edge.properties && { properties: edge.properties }),
      });
    }
  }

  for (const edge of base.edges) {
    if (!currentEdgeMap.has(edge.id)) {
      ops.push({ op: 'edge.remove', edgeId: edge.id });
    }
  }

  return ops;
}
