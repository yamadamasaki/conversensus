import type { EdgeKind, NodeKind, Template } from './types';

/**
 * 適用された template を畳んで**選べる種別の一覧**を出す。
 *
 * 接続の可否は種別 id で判定するので `kind.ts` にある (設計 D5)。ここは
 * 「メニューに何を並べるか」だけを持つ。
 *
 * **複数 template を前提にする** (設計 §4)。当面は 1 つしか当てないが、畳み方を後から
 * 決めると「1 つのときだけ通る実装」が固定される。畳み方は一貫して **和** である —
 * template は語彙を**足す**ものであって、狭めるものではない。
 */

/** id で重複を除いた和。**先に来た template の定義を残す** (メニューの並びを安定させる) */
function unionById<T extends { id: string }>(kinds: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const k of kinds) {
    if (seen.has(k.id)) continue;
    seen.add(k.id);
    out.push(k);
  }
  return out;
}

/** 選べる node の種別。適用された template の `nodeKinds` の和 */
export function nodeKindsOf(templates: readonly Template[]): NodeKind[] {
  return unionById(templates.flatMap((t) => t.nodeKinds));
}

/** 選べる edge の種別。適用された template の `edgeKinds` の和 */
export function edgeKindsOf(templates: readonly Template[]): EdgeKind[] {
  return unionById(templates.flatMap((t) => t.edgeKinds));
}
