import type { PropertyName } from '../events/unified';
import type { TemplateId } from '../schemas';
import type { EdgeKind, NodeKind, NodeKindId, Template } from './types';

/**
 * この template が「どの種別か」を記録するプロパティ名 (設計 D3)。
 *
 * **`nodeType` (markdown / グループ / 画像) の軸ではない。**toulmin の「主張」は
 * 見た目としては markdown node である。種別は意味の軸なのでプロパティに載せる。
 *
 * **template ごとに名前空間を持つ。**template は `spec/propertyEditor.md` の言う
 * **拡張 (extension)** であり、「提供者のドメイン (逆順)」を前置する規約に従う
 * (仕様の例がまさに `jp.co.metabolics.claim` である)。`TemplateId` が逆順ドメインなので、
 * そこから導けば名前空間は自動的に分かれる。
 *
 * **system (`app.conversensus.*`) に置いてはいけない。**それは本体のものを指す枠で、
 * 仕様は拡張のために別の枠を用意している。
 *
 * template ごとに分かれる結果、**1 つの node が複数の template の種別を同時に持てる**。
 * これは一般化として正しい — 制約が働くのは 1 つの template の中だからである。
 */
export function kindPropertyOf(templateId: TemplateId): PropertyName {
  return `${templateId}.kind`;
}

/**
 * この template における種別 id を読む。無ければ undefined
 * (= その template の要素ではない)。
 *
 * **値を信用しない。**op-log は他の参加者が書くので、文字列でない値や空文字が
 * 入り得る。落ちずに「種別なし」として読む。
 */
export function kindIdIn(
  template: Template,
  properties: Readonly<Record<string, unknown>> | undefined,
): NodeKindId | undefined {
  const value = properties?.[kindPropertyOf(template.id)];
  if (typeof value !== 'string' || value === '') return undefined;
  return template.nodeKinds.some((k) => k.id === value)
    ? (value as NodeKindId)
    : undefined;
}

/** この template における種別。知らない id は undefined (種別名を変えても id は切れない) */
export function nodeKindIn(
  template: Template,
  properties: Readonly<Record<string, unknown>> | undefined,
): NodeKind | undefined {
  const id = kindIdIn(template, properties);
  return id === undefined
    ? undefined
    : template.nodeKinds.find((k) => k.id === id);
}

/**
 * 両端の種別から、その edge になりうる種類の**候補**を返す (設計 D5)。
 *
 * **候補の数が挙動を決める** — 0 なら繋げない、1 なら自動、複数なら選ばせる。
 * step2 で起こるのは 0 と 1 だけだが、**判定は最初から一般の形にしておく**。
 * 後から分岐を足すと「一意のときだけ通る実装」が固定される。
 *
 * **判定は template ごとに閉じる。**両端が同じ template の種別を持つときだけ、その
 * template の規則が効く。混ぜて引くと、T1 の edge 規則を T2 の node 種別で満たす
 * 混線が起こる。
 */
export function edgeKindCandidates(
  templates: readonly Template[],
  fromProperties: Readonly<Record<string, unknown>> | undefined,
  toProperties: Readonly<Record<string, unknown>> | undefined,
): EdgeKind[] {
  return templates.flatMap((t) => {
    const from = kindIdIn(t, fromProperties);
    const to = kindIdIn(t, toProperties);
    if (from === undefined || to === undefined) return [];
    return t.edgeKinds.filter(
      (ek) => ek.from.includes(from) && ek.to.includes(to),
    );
  });
}

/**
 * この接続が template の規則に従うべきものか (= 両端が**同じ** template の要素か)。
 *
 * **`edgeKindCandidates` が空であることと区別する。**両端とも同じ template の種別を
 * 持つのに候補が 0 なら「許されない組」で繋げないが、そうでなければ「制約の対象外」で
 * 自由に繋げる (設計 D5)。両者を混同すると、**普通のノードに繋げなくなる**。
 */
export function isTemplateEdge(
  templates: readonly Template[],
  fromProperties: Readonly<Record<string, unknown>> | undefined,
  toProperties: Readonly<Record<string, unknown>> | undefined,
): boolean {
  return templates.some(
    (t) =>
      kindIdIn(t, fromProperties) !== undefined &&
      kindIdIn(t, toProperties) !== undefined,
  );
}
