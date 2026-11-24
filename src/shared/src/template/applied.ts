/**
 * 既にある sheet に後から当てた template (#355、計画 apply-template-355.md)
 *
 * 作るときに当てる template は `sheet.create.templateIds` に載る。後から当てるものは**op の種類を
 * 足さず** (architecture step3 §3.3 D3)、sheet のプロパティで表す。
 *
 * - **template graph ごとに別のキー** (`app.conversensus.appliedTemplate.<template graph の sheet の id>`)。
 *   `sheet.setProperty` はキーごとに後勝ちなので、1 つのキーに配列を置くと、2 人が同時に別の template を
 *   当てたときに片方が消える。キーを分ければ両方残る
 * - 値は当てた時点の切断面 `{ at }` (`TemplateSheetRef` から、キーにある `sheet` を除いたもの)
 * - 値を消せば外れる形にしてある (外す入口は今は無い)
 */

import type { VersionVector } from '../events/causality';
import type { PropertyName } from '../events/unified';
import {
  type Sheet,
  type SheetId,
  SheetIdSchema,
  type TemplateRef,
  type TemplateSheetRef,
  VersionVectorSchema,
} from '../schemas';

/** 後から当てた template のプロパティ名の前置き。名前空間は sheet の種別 (`app.conversensus.sheetKind`) にそろえる */
export const APPLIED_TEMPLATE_PROPERTY_PREFIX =
  'app.conversensus.appliedTemplate.';

/** template graph を後から当てるときのプロパティ名 */
export function appliedTemplatePropertyOf(
  templateSheetId: SheetId,
): PropertyName {
  return `${APPLIED_TEMPLATE_PROPERTY_PREFIX}${templateSheetId}`;
}

/** 後から当てるときのプロパティの値 */
export function appliedTemplateValueOf(at: VersionVector): {
  at: VersionVector;
} {
  return { at };
}

/**
 * プロパティ名から、後から当てた template graph の sheet の id を読む。後から当てた template の
 * プロパティでなければ `undefined`
 */
export function appliedTemplateSheetOf(
  name: PropertyName,
): SheetId | undefined {
  if (!name.startsWith(APPLIED_TEMPLATE_PROPERTY_PREFIX)) return undefined;
  const parsed = SheetIdSchema.safeParse(
    name.slice(APPLIED_TEMPLATE_PROPERTY_PREFIX.length),
  );
  return parsed.success ? parsed.data : undefined;
}

/**
 * sheet に当たっている template をすべて求める。**template を読む所はどこもこれを使う** (`sheet.templateIds`
 * は作るときのものだけである)。
 *
 * - 並びは「作るときのもの (その順) → 後から当てたもの (template graph の sheet の id の順)」。
 *   プロパティの並びは畳み込みの順に依るので、id で並べて誰の手元でも同じ順にする
 * - 同じ template graph が両方にあれば、**プロパティの切断面**を採り、並びは作るときの位置に置く
 *   (計画 template-update.md K3・D1)。版を進める (pull) ときは、作るときに当てたものでもプロパティに
 *   書くからである。`sheet.create` は書き換えられない
 * - 読めない値 (形の違う切断面) は黙って落とす。相手の新しい書き方でも sheet を開けるべきだから
 *   (`sheetKindOf` と同じ)
 */
export function appliedTemplateRefs(
  sheet: Pick<Sheet, 'templateIds' | 'properties'>,
): TemplateRef[] {
  const created = sheet.templateIds ?? [];
  const fromProperties = new Map<SheetId, VersionVector>();
  for (const [name, value] of Object.entries(sheet.properties ?? {})) {
    const templateSheet = appliedTemplateSheetOf(name);
    if (templateSheet === undefined) continue;
    const at = VersionVectorSchema.safeParse(
      (value as { at?: unknown } | null)?.at,
    );
    if (at.success) fromProperties.set(templateSheet, at.data);
  }
  if (fromProperties.size === 0) return created;
  const taken = new Set<SheetId>();
  const pulled = created.map((ref): TemplateRef => {
    if (typeof ref === 'string') return ref;
    taken.add(ref.sheet);
    const at = fromProperties.get(ref.sheet);
    return at === undefined ? ref : { sheet: ref.sheet, at };
  });
  const later = [...fromProperties]
    .filter(([templateSheet]) => !taken.has(templateSheet))
    .map(
      ([templateSheet, at]): TemplateSheetRef => ({ sheet: templateSheet, at }),
    )
    .sort((a, b) => (a.sheet < b.sheet ? -1 : a.sheet > b.sheet ? 1 : 0));
  return [...pulled, ...later];
}

/** sheet に当たっている template graph の sheet の id (後から当てる候補から除くため) */
export function appliedTemplateSheetIds(
  sheet: Pick<Sheet, 'templateIds' | 'properties'>,
): Set<SheetId> {
  return new Set(
    appliedTemplateRefs(sheet).flatMap((ref) =>
      typeof ref === 'string' ? [] : [ref.sheet],
    ),
  );
}
