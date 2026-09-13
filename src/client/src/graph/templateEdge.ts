import {
  type EdgeKindRef,
  edgeKindCandidates,
  isTemplateEdge,
  kindPropertyOf,
  type Template,
} from '@conversensus/shared';
import type { Edge, Node } from '@xyflow/react';

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

/**
 * 当たっている template の中で、この edge が持っている種類。
 *
 * **名前だけで見分ける `hasTemplateKind` とは別物である。**あちらは「編集させてよいか」の
 * ように template を特定する必要が無い問いに使う。ここは**繋ぎ替え先が同じ種類か**を
 * 比べるので、種類の実体まで解決しなければならない。
 *
 * 解決できなければ `undefined` — **知らない template の種類で操作を塞がない**
 * (`templatesOf` が知らない id を黙って落とすのと同じ判断)。相手の template を
 * 持たないせいで繋ぎ替えられなくなる方が悪い。
 */
function currentEdgeKindId(
  templates: readonly Template[],
  edge: Edge,
): { templateId: string; kindId: string } | undefined {
  const properties = edge.data?.properties as
    | Record<string, unknown>
    | undefined;
  if (!properties) return undefined;
  for (const t of templates) {
    const value = properties[kindPropertyOf(t.id)];
    if (typeof value !== 'string' || value === '') continue;
    if (t.edgeKinds.some((k) => k.id === value)) {
      return { templateId: t.id, kindId: value };
    }
  }
  return undefined;
}

/**
 * この繋ぎ替えを許してよいか (仕様 `template.md` の OnMutation)。
 *
 * **template の edge は「種類が変わらない範囲でのみ」繋ぎ替えられる。**
 *
 * - 可: データA → 主張A を データA → 主張B に (組は (データ, 主張) のまま)
 * - 不可: データA → 主張A を 論拠A → 主張A に (種類が「正当化する」になる)
 * - 不可: toulmin node 以外への繋ぎ替え (種類が無くなる)
 *
 * **禁じているのは繋ぎ替えではなく、種類が変わることである。**「支える先の主張を
 * 付け替える」は普通に起こる編集なので、これを塞ぐと使える操作まで失う。一方
 * 種類が変わる繋ぎ替えを許すと、**label は変更できない**のに種類だけ変わって
 * ラベルが古いまま残る。
 *
 * **template の種類を持たない edge は今までどおり自由**である。`canConnectByTemplate`
 * との違いはそこで、あちらは「新しく繋いでよいか」なので元の edge を見ない。
 */
export function canReconnectByTemplate(
  templates: readonly Template[],
  nodes: readonly Node[],
  edge: Edge,
  source: string,
  target: string,
): boolean {
  const current = currentEdgeKindId(templates, edge);
  if (!current) return true; // 当たっている template の種類ではない = 制約の対象外

  const next = edgeKindFor(templates, nodes, source, target);
  if (!next) return false; // 種類が決まらない先へは繋ぎ替えられない
  // **同じ種類に落ちるときだけ許す。**id で比べる — label は表示なので、
  // template が種別名を変えても判定が揺れてはいけない
  return (
    next.templateId === current.templateId && next.kind.id === current.kindId
  );
}
