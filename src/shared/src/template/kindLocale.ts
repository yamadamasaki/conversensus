/**
 * 種類の名前・説明を言語ごとに持ち、見る人の言語で表示する (#356、計画 kind-i18n-356.md)
 *
 * **#330 案 B を改める。**今までは種の名前を作った人の言語で File に焼き込み、表示のたびに言語で引き直さなかった。
 * これでは言語の違う参加者が読めない名前を見る。訳は template graph の種類の node・edge の property に置き
 * (`label:<言語>`・`description:<言語>`)、表示するときに見る人の言語で引く。
 *
 * - **種類の隣に置く。**表を 1 か所にまとめると、種類の id (NodeId) をキーに書く必要がある
 * - 利用者が書く property なので system の名前空間 (`app.conversensus.`) には置かない
 * - **データは変えない。**当てたシートの node・edge に書く label は今までどおり種類の名前で、訳すのは表示だけ
 */

import type { PropertyName } from '../events/unified';
import { kindPropertyOf } from './kind';
import type { EdgeKind, NodeKind, Template } from './types';

/** 言語。client の `Locale` と同じ綴り (shared は client を知らないので文字列で受ける) */
export type KindLocale = string;

/** 言語ごとの名前の property の前置き (`label:en`) */
export const KIND_LABEL_PROPERTY_PREFIX = 'label:';
/** 言語ごとの説明の property の前置き (`description:en`) */
export const KIND_DESCRIPTION_PROPERTY_PREFIX = 'description:';

export function kindLabelPropertyOf(locale: KindLocale): PropertyName {
  return `${KIND_LABEL_PROPERTY_PREFIX}${locale}`;
}

export function kindDescriptionPropertyOf(locale: KindLocale): PropertyName {
  return `${KIND_DESCRIPTION_PROPERTY_PREFIX}${locale}`;
}

/** 訳の property か。template graph の property を当てた先の既定値にするときに除く (訳が node ごとに複製されないため) */
export function isKindTranslationProperty(name: PropertyName): boolean {
  return (
    name.startsWith(KIND_LABEL_PROPERTY_PREFIX) ||
    name.startsWith(KIND_DESCRIPTION_PROPERTY_PREFIX)
  );
}

/**
 * property から、前置きの付いた訳を言語ごとに読む。空の言語・空でない文字列以外の値は落とす
 * (相手が何を書いても落ちない)。1 つも無ければ `undefined`
 */
export function translationsIn(
  properties: Readonly<Record<PropertyName, unknown>> | undefined,
  prefix: string,
): Record<KindLocale, string> | undefined {
  const entries = Object.entries(properties ?? {}).flatMap(
    ([name, value]): [KindLocale, string][] => {
      if (!name.startsWith(prefix)) return [];
      const locale = name.slice(prefix.length);
      return locale !== '' && typeof value === 'string' && value.trim() !== ''
        ? [[locale, value]]
        : [];
    },
  );
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

/** 訳を property にする (`translationsIn` の逆) */
export function translationProperties(
  translations: Readonly<Record<KindLocale, string>> | undefined,
  prefix: string,
): Record<PropertyName, string> {
  return Object.fromEntries(
    Object.entries(translations ?? {}).map(([locale, text]) => [
      `${prefix}${locale}`,
      text,
    ]),
  );
}

/** 種類の名前をその言語で。訳が無ければ template graph の名前 */
export function kindLabelIn(
  kind: NodeKind | EdgeKind,
  locale: KindLocale,
): string {
  return kind.labels?.[locale] ?? kind.label;
}

/** node の種類の説明をその言語で。訳が無ければ template graph の説明 */
export function kindDescriptionIn(
  kind: NodeKind,
  locale: KindLocale,
): string | undefined {
  return kind.descriptions?.[locale] ?? kind.description;
}

/** その種類の名前のどれか (template graph の名前か、どれかの言語の訳) か */
function isNameOf(kind: NodeKind | EdgeKind, label: string): boolean {
  return (
    label === kind.label || Object.values(kind.labels ?? {}).includes(label)
  );
}

/**
 * 当てたシートの node・edge の label を、見る人の言語で表示する形にする。
 *
 * - 要素がどれかの template の種類を持ち、label が**その種類の名前かその訳のどれか**に等しければ、その言語の訳
 *   (無ければ template graph の名前) を返す。訳とも照らすのは、別の言語の名前で焼き込まれた既にある File
 *   (#330 案 B で英語の参加者が作った種) も訳すため
 * - それ以外 (書き換えた label・種類を持たない要素) は label のまま
 * - 複数の template の種類を持つときは、先に当たった template で決める (`nodeKindsOf` の和と同じ順)
 */
export function displayKindLabel(
  templates: readonly Template[],
  element: 'node' | 'edge',
  properties: Readonly<Record<PropertyName, unknown>> | undefined,
  label: string,
  locale: KindLocale,
): string {
  for (const t of templates) {
    const id = properties?.[kindPropertyOf(t.id)];
    if (typeof id !== 'string') continue;
    const kinds: readonly (NodeKind | EdgeKind)[] =
      element === 'node' ? t.nodeKinds : t.edgeKinds;
    const kind = kinds.find((k) => k.id === id);
    if (kind && isNameOf(kind, label)) return kindLabelIn(kind, locale);
  }
  return label;
}
