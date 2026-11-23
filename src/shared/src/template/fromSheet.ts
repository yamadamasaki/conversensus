/**
 * template graph → `Template` (step3 Phase 4 S4-1, 仕様 template graph)
 *
 * template graph は種別 `template` の sheet である (op の種類は足さない, architecture step3 §3.3 D3)。
 * 適用先の振る舞い (種類のメニュー・接続の可否・edge の種類の自動決定・property の候補) は
 * どれも `Template` を受けるので、**template graph の sheet を `Template` に読み替える**ことで
 * そのまま使う。
 *
 * 読み替えの規則 (仕様):
 *
 * - **label のある node** = node の種類。ただし **label が重複した node は種類にしない** (template-update K6)。
 *   どちらを採るかを決める根拠が無く、共同編集では書き込みの時点で一意を強制できないので、読む側で両方とも
 *   無効にする。重複は template graph の画面で警告する (`duplicateKindLabels`)
 * - label のある node の種類の id は NodeId (Q3)、表示名は label、説明は本文、
 *   見た目は node の見た目 (template-update K11)
 * - **少なくとも一方の端が種類である edge** = edge の種類。種類でない端は「任意」
 *   (`ANY_NODE_KIND`: 適用先でこの template の種別を持たない node)。label の重複で無効になった node に
 *   繋がる edge は種類にしない
 * - **label の無い node 同士の edge と、label の無い node** = 使い方の説明書き。種類にしない
 * - 種類になった node / edge の property = 適用先の既定値 (種別プロパティそのものと、言語ごとの名前・説明と、
 *   型・editable の宣言は除く)
 * - `app.conversensus.propertySchema.<名前>` の property = その property の型・editable の宣言 (template-update K9)
 * - `label:<言語>`・`description:<言語>` の property = 言語ごとの名前・説明 (#356、`kindLocale.ts`)
 */

import { projectAddress } from '../events/address';
import { sheetKindOf, TEMPLATE_SHEET_KIND } from '../events/sheetKind';
import type { Batch, PropertyName } from '../events/unified';
import type {
  FileId,
  GraphEdge,
  GraphNode,
  Sheet,
  TemplateId,
  TemplateRef,
} from '../schemas';
import { isKindProperty } from './kind';
import {
  isKindTranslationProperty,
  KIND_DESCRIPTION_PROPERTY_PREFIX,
  KIND_LABEL_PROPERTY_PREFIX,
  translationsIn,
} from './kindLocale';
import { isPropertySchemaProperty, propertySchemaIn } from './propertySchema';
import {
  ANY_NODE_KIND,
  type EdgeKindId,
  type NodeKindId,
  type Template,
  TemplateSchema,
} from './types';

/**
 * template graph の template id (Q2)。**種別プロパティの名前空間を兼ねる** (`kindPropertyOf`) —
 * 利用者の template graph には提供者のドメインが無いので、sheet の id から作る。同じ template graph を
 * 当てたシート同士で同じ名前になり、別の template graph とは分かれる
 */
export function templateIdOf(templateSheetId: string): TemplateId {
  return `template.${templateSheetId}` as TemplateId;
}

/**
 * 種別プロパティと訳と宣言を除いた property (既定値にするもの)。訳を残すと、当てたシートの node ごとに訳が
 * 複製される (#356)。宣言 (型・editable、template-update K9) も template の定義であって既定値ではない
 */
function defaultsOf(
  properties: Record<PropertyName, unknown> | undefined,
): Record<PropertyName, unknown> {
  return Object.fromEntries(
    Object.entries(properties ?? {}).filter(
      ([name]) =>
        !isKindProperty(name) &&
        !isKindTranslationProperty(name) &&
        !isPropertySchemaProperty(name),
    ),
  );
}

/** 言語ごとの名前・説明 (#356)。無いものは載せない */
function translationsOf(
  properties: Record<PropertyName, unknown> | undefined,
  withDescriptions: boolean,
) {
  const labels = translationsIn(properties, KIND_LABEL_PROPERTY_PREFIX);
  const descriptions = withDescriptions
    ? translationsIn(properties, KIND_DESCRIPTION_PROPERTY_PREFIX)
    : undefined;
  return {
    ...(labels && { labels }),
    ...(descriptions && { descriptions }),
  };
}

const labelOf = (element: GraphNode | GraphEdge): string =>
  element.label?.trim() ?? '';

/**
 * template graph の中で、2 つ以上の node が持っている label (template-update K6)。前後の空白は除いて比べる。
 * 並びは label の順 (誰の手元でも同じ警告になるように)
 */
export function duplicateKindLabels(sheet: Pick<Sheet, 'nodes'>): string[] {
  const counts = new Map<string, number>();
  for (const n of sheet.nodes) {
    const label = labelOf(n);
    if (label !== '') counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts]
    .filter(([, count]) => count > 1)
    .map(([label]) => label)
    .sort();
}

/** template graph の sheet を `Template` に読み替える */
export function templateFromSheet(
  sheet: Sheet,
  templateId: TemplateId,
): Template {
  const duplicated = new Set(duplicateKindLabels(sheet));
  const isDuplicated = (n: GraphNode) => duplicated.has(labelOf(n));
  const kindNodes = sheet.nodes.filter(
    (n) => labelOf(n) !== '' && !isDuplicated(n),
  );
  const kinds = new Set<string>(kindNodes.map((n) => n.id));
  // 無効にした種類の node。そこに繋がる edge は種類にしない — 「任意」の端と読むと、
  // 定義した人の意図に無い「任意の node と繋がる種類」ができてしまう
  const invalid = new Set<string>(
    sheet.nodes.filter(isDuplicated).map((n) => n.id),
  );
  const endOf = (nodeId: string): NodeKindId =>
    (kinds.has(nodeId) ? nodeId : ANY_NODE_KIND) as NodeKindId;

  return TemplateSchema.parse({
    id: templateId,
    name: sheet.name,
    nodeKinds: kindNodes.map((n) => ({
      id: n.id as string as NodeKindId,
      label: labelOf(n),
      ...(n.content.trim() !== '' && { description: n.content }),
      ...(n.nodeType && { nodeType: n.nodeType }),
      ...translationsOf(n.properties, true),
      defaults: defaultsOf(n.properties),
      schema: propertySchemaIn(n.properties),
    })),
    edgeKinds: sheet.edges
      .filter(
        (e) =>
          (kinds.has(e.source) || kinds.has(e.target)) &&
          !invalid.has(e.source) &&
          !invalid.has(e.target),
      )
      .map((e) => ({
        id: e.id as string as EdgeKindId,
        label: labelOf(e),
        ...translationsOf(e.properties, false),
        from: [endOf(e.source)],
        to: [endOf(e.target)],
        // 持ちうる property = 既定値のあるもの + 宣言だけのもの (既定値の無い宣言もある)
        properties: [
          ...new Set([
            ...Object.keys(defaultsOf(e.properties)),
            ...Object.keys(propertySchemaIn(e.properties)),
          ]),
        ],
        defaults: defaultsOf(e.properties),
        schema: propertySchemaIn(e.properties),
      })),
  });
}

/**
 * シートの `templateIds` を、当てる template の実体に解決する。
 *
 * - `{ sheet, at }`: 同じ File の template graph を**その切断面**で読み (仕様: 適用する内容は適用先の
 *   生成時に決まる)、`templateFromSheet` で読み替える
 * - 作り込みの id: **解決しない** (Q1)。template はすべて File の中の template graph である
 *
 * **解決できないものは黙って落とす**: 無い sheet、種別が template でない sheet、作り込みの id。相手の作ったシートを開けなくなるより、種類が少し引けない方が遥かに軽い
 */
export function resolveTemplates(
  refs: readonly TemplateRef[] | undefined,
  trunk: Batch[],
  fileId: FileId,
): Template[] {
  if (!refs) return [];
  return refs.flatMap((ref): Template[] => {
    // 作り込みの id は解決しない (Q1: template はすべて File の中の template graph)。Phase 4 より前に
    // 作り込みの Toulmin を当てたシートは、ただのシートに縮退する (互換は取らない)
    if (typeof ref === 'string') return [];
    const sheet = projectAddress(
      { fileId, sheetId: ref.sheet, branchId: null, cut: ref.at },
      { trunk },
    );
    if (!sheet || sheetKindOf(sheet) !== TEMPLATE_SHEET_KIND) return [];
    return [templateFromSheet(sheet, templateIdOf(ref.sheet))];
  });
}
