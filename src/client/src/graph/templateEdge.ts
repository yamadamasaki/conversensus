import {
  type EdgeKindRef,
  edgeKindCandidates,
  isTemplateEdge,
  type Template,
} from '@conversensus/shared';
import type { Node } from '@xyflow/react';

/** React Flow のノードから properties を取り出す (型が守らない境界なのでここに閉じる) */
function propertiesOf(
  nodes: readonly Node[],
  id: string,
): Record<string, unknown> | undefined {
  return nodes.find((n) => n.id === id)?.data?.properties as
    | Record<string, unknown>
    | undefined;
}

/**
 * 両端から edge の種類を決める (設計 D5)。**候補がちょうど 1 のときだけ**返す。
 *
 * 候補 0 は「繋げない」だが、**止めるのは `canConnectByTemplate` の仕事**である。
 * ここは既に繋がると決まったものに種類を与えるだけなので、決まらなければ何もしない。
 * 候補が複数のときに選ばせる UI は step2 では作らない (D5) ので、同じく何もしない。
 */
export function edgeKindFor(
  templates: readonly Template[],
  nodes: readonly Node[],
  source: string,
  target: string,
): EdgeKindRef | undefined {
  const candidates = edgeKindCandidates(
    templates,
    propertiesOf(nodes, source),
    propertiesOf(nodes, target),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

/**
 * この接続を許してよいか (設計 D5)。**拒否するのは template の要素どうしだけ**である。
 *
 * 「候補 0」と「制約の対象外」を取り違えないことがこの関数の主題である —
 * どちらも候補は空だが、前者は許されない組で、後者は普通のノードが絡む自由な接続である。
 * 混同すると**普通のノードに繋げなくなる**。
 */
export function canConnectByTemplate(
  templates: readonly Template[],
  nodes: readonly Node[],
  source: string,
  target: string,
): boolean {
  const from = propertiesOf(nodes, source);
  const to = propertiesOf(nodes, target);
  if (!isTemplateEdge(templates, from, to)) return true; // 制約の対象外
  return edgeKindCandidates(templates, from, to).length > 0;
}
