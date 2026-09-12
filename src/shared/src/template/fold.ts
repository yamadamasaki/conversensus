import type { TemplateId } from '../schemas';
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

/**
 * 種別 id で重複を除いた和。**先に来た template の定義を残す** (メニューの並びを安定させる)。
 *
 * 別々の template が同じ id を使うと片方が消えるが、**メニューは表示の話**なので
 * それでよい。書き込み先のプロパティは template ごとに分かれているので、
 * **実体としては衝突しない** (`kindPropertyOf`)。
 */
function unionByKindId<T extends { kind: { id: string } }>(
  refs: readonly T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of refs) {
    if (seen.has(r.kind.id)) continue;
    seen.add(r.kind.id);
    out.push(r);
  }
  return out;
}

/**
 * 種別と、**それを定義した template**。
 *
 * 種別だけでは足りない — 種別を書き込むプロパティ名は template ごとに分かれる
 * (`kindPropertyOf`) ので、**選んだ種別がどの template のものかを失ってはいけない**。
 */
export type NodeKindRef = { templateId: TemplateId; kind: NodeKind };
export type EdgeKindRef = { templateId: TemplateId; kind: EdgeKind };

/** 選べる node の種別。適用された template の `nodeKinds` の和 */
export function nodeKindsOf(templates: readonly Template[]): NodeKindRef[] {
  return unionByKindId(
    templates.flatMap((t) =>
      t.nodeKinds.map((kind) => ({ templateId: t.id, kind })),
    ),
  );
}

/** 選べる edge の種別。適用された template の `edgeKinds` の和 */
export function edgeKindsOf(templates: readonly Template[]): EdgeKindRef[] {
  return unionByKindId(
    templates.flatMap((t) =>
      t.edgeKinds.map((kind) => ({ templateId: t.id, kind })),
    ),
  );
}
