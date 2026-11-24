import type { PropertyName } from '../events/unified';
import type { TemplateId } from '../schemas';
import type { EdgeKindRef } from './fold';
import {
  ANY_NODE_KIND,
  type EdgeKind,
  type NodeKind,
  type NodeKindId,
  type Template,
} from './types';

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
  return `${templateId}${KIND_SUFFIX}`;
}

/** 種別プロパティの語尾。`kindPropertyOf` が付けるものと必ず揃える */
const KIND_SUFFIX = '.kind';

/**
 * その名前が**どれかの template の種別プロパティか**。
 *
 * どの template のものかを問わない判定である。「編集させてよいか」のように
 * **template を特定する必要が無い問い**に使う — 描画側に template を配るより、
 * 規約をここに 1 つ置く方が漏れない。
 *
 * custom (`.` を含まない) が誤ってこれに当たることは無い (`spec/propertyEditor.md`)。
 */
export function isKindProperty(name: string): boolean {
  return name.endsWith(KIND_SUFFIX);
}

/** その要素がどれかの template の種別を持つか (= template が付けたものか) */
export function hasTemplateKind(
  properties: Readonly<Record<string, unknown>> | undefined,
): boolean {
  return Object.keys(properties ?? {}).some(isKindProperty);
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
 *
 * 返すのが `EdgeKindRef` (種別 + template) なのは、**種別を書き込むプロパティ名が
 * template ごとに分かれる**ためである (`kindPropertyOf`)。
 */
export function edgeKindCandidates(
  templates: readonly Template[],
  fromProperties: Readonly<Record<string, unknown>> | undefined,
  toProperties: Readonly<Record<string, unknown>> | undefined,
): EdgeKindRef[] {
  return templates.flatMap((t) => {
    const from = kindIdIn(t, fromProperties);
    const to = kindIdIn(t, toProperties);
    // 両端とも種別を持たない組は、この template の対象外 (任意どうしの種類は作らない)
    if (from === undefined && to === undefined) return [];
    // 種別を持たない端は「任意」に当たる (step3 Phase 4)
    const matches = (
      ends: readonly NodeKindId[],
      kind: NodeKindId | undefined,
    ) => ends.includes(kind ?? ANY_NODE_KIND);
    return t.edgeKinds
      .filter((ek) => matches(ek.from, from) && matches(ek.to, to))
      .map((kind) => ({ templateId: t.id, kind }));
  });
}

/** 片端が「任意」の edge の種類か (template graph で label の無い node と繋がっていた種類) */
export function hasAnyEnd(kind: EdgeKind): boolean {
  return kind.from.includes(ANY_NODE_KIND) || kind.to.includes(ANY_NODE_KIND);
}

/**
 * 候補から、**選ばせずに付けてよい**種類を返す (template-update K15)。無ければ undefined。
 *
 * 付けてよいのは、候補がちょうど 1 つで、その種類の両端が種類のとき (template の制約の内側) だけである。
 * **片端が「任意」の種類は自動で付けない** — 種類の node を普通の node へ繋ぐたびに、その種類
 * (例: 接地の慣習の `external`) の label が付いてしまう。任意の端の種類は「引けるが引かなくてもよい」
 * ものなので、選ばせて、ラベルなしで繋ぐことも許す。
 *
 * 片端が任意の種類と、両端が種類の種類は、同じ template の中では同じ組の候補に並ばない
 * (両端とも種類を持つ組は任意の端に当たらない)。別の template から並んだときは、任意の端の種類が
 * 1 つでもあれば選ばせる
 */
export function autoEdgeKind(
  candidates: readonly EdgeKindRef[],
): EdgeKindRef | undefined {
  const [only] = candidates;
  return candidates.length === 1 && only && !hasAnyEnd(only.kind)
    ? only
    : undefined;
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

/** 種類を持つ edge が、今の template の規則を満たさない理由 (template-update D5) */
export const EDGE_VIOLATION = {
  /** edge の種類が template に無い (template graph で消された) */
  UNKNOWN_KIND: 'unknownKind',
  /** 両端の種類の組が、その種類の接続規則に合わない */
  ENDS: 'ends',
} as const;
export type EdgeViolation =
  (typeof EDGE_VIOLATION)[keyof typeof EDGE_VIOLATION];

/**
 * 種類を持つ edge が、当たっている template の今の規則を満たすかを見る (template-update D5、K2)。
 * 満たさなければ理由を、満たすか対象外なら `undefined` を返す。
 *
 * pull で template が変わると、既にある edge が規則を外れることがある。**消しも置き換えもせず**、印で
 * 見せるために使う (K2: 違反は違反として見せる)。
 *
 * - 見るのは、edge が種類を持つ template だけ。**当たっていない template の種類は見ない** — 相手の template
 *   を持たないせいで違反に見せない (`canReconnectByTemplate` と同じ判断)
 * - 端の node の種類は `kindIdIn` で読む。今の template に無い種類 (消された) の node は「任意」に当たる
 * - 複数の template の種類を持つときは、どれか 1 つでも外れていれば、最初の理由を返す
 */
export function edgeViolationOf(
  templates: readonly Template[],
  edgeProperties: Readonly<Record<string, unknown>> | undefined,
  fromProperties: Readonly<Record<string, unknown>> | undefined,
  toProperties: Readonly<Record<string, unknown>> | undefined,
): EdgeViolation | undefined {
  for (const t of templates) {
    const value = edgeProperties?.[kindPropertyOf(t.id)];
    if (typeof value !== 'string' || value === '') continue;
    const kind = t.edgeKinds.find((k) => k.id === value);
    if (!kind) return EDGE_VIOLATION.UNKNOWN_KIND;
    const from = kindIdIn(t, fromProperties) ?? ANY_NODE_KIND;
    const to = kindIdIn(t, toProperties) ?? ANY_NODE_KIND;
    if (!kind.from.includes(from) || !kind.to.includes(to))
      return EDGE_VIOLATION.ENDS;
  }
  return undefined;
}
