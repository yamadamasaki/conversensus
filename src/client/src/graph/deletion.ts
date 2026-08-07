import type { Edge, Node } from '@xyflow/react';
import { descendantIdsOf } from './coords';

/**
 * delete で消えるノードとエッジを求める。
 *
 * グループを選ぶと**その子孫もまとめて消える**。copy (`collectCopyData`) が既に
 * 子孫込みで動いており、delete だけ中身を置き去りにする非対称をなくす。
 * 中身を残したい場合はグループ解除してから削除する。
 *
 * 消えるノードに繋がるエッジは、選択されていなくても巻き込んで消す。
 * 端点の無いエッジを残さないため。返す順序は引数の順序を保つので、
 * 復元時も配列上の親子の並び (親が先) が崩れない。
 */
export function deletionTargets(
  nodes: Node[],
  edges: Edge[],
): { nodes: Node[]; edges: Edge[] } {
  const doomedIds = new Set<string>();
  for (const node of nodes) {
    if (!node.selected) continue;
    doomedIds.add(node.id);
    for (const id of descendantIdsOf(node.id, nodes)) doomedIds.add(id);
  }

  return {
    nodes: nodes.filter((n) => doomedIds.has(n.id)),
    edges: edges.filter(
      (e) => e.selected || doomedIds.has(e.source) || doomedIds.has(e.target),
    ),
  };
}
