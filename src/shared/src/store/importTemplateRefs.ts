/**
 * import で template への参照を付け替える (#327)
 *
 * import (`LocalStore.importFile`) は Sheet・node・edge の id をすべて振り直す。template を当てた
 * Sheet は、template graph を **id で**指しているので、そのままでは参照が切れる。指している所は 3 つある。
 *
 * 1. Sheet の `templateIds` の `{ sheet, at }` — template graph の Sheet の id と、当てた時点の切断面
 * 2. 種別の property の**名前** `template.<template graph の Sheet の id>.kind` (`templateIdOf`・`kindPropertyOf`)
 * 3. 種別の property の**値** — template graph の node / edge の id (`templateFromSheet`)
 *
 * **切断面は genesis 全体にする。**import した File の中身はすべて genesis の batch で、元の切断面は
 * 元の File の actor を指すので何も含まない (template graph の Sheet が「まだ無い」と読まれ、template が
 * 黙って落ちる)。書き出した File に載っているのは template graph の最後の姿なので、それを含む切断面が
 * 当てた時点の定義に最も近い
 */

import { GENESIS_ACTOR } from '../events/unified';
import type { GraphFile, SheetId, TemplateRef } from '../schemas';
import { templateIdOf } from '../template/fromSheet';
import { kindPropertyOf } from '../template/kind';

/** 振り直した id の対応。要素 (node / edge) は Sheet ごと (template graph の種別の id はその Sheet の要素の id) */
export type ImportIdMaps = {
  sheet: ReadonlyMap<string, SheetId>;
  element: (sheetId: string, elementId: string) => string | undefined;
};

const TEMPLATE_KIND_PROPERTY = /^template\.(.+)\.kind$/;

/** 種別の property を新しい template graph へ付け替える。template の種別でない property はそのまま */
export function remapKindProperties(
  properties: Readonly<Record<string, unknown>>,
  ids: ImportIdMaps,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).map(([name, value]) => {
      const from = TEMPLATE_KIND_PROPERTY.exec(name)?.[1];
      const to = from === undefined ? undefined : ids.sheet.get(from);
      if (from === undefined || to === undefined) return [name, value];
      const kind =
        typeof value === 'string' ? (ids.element(from, value) ?? value) : value;
      return [kindPropertyOf(templateIdOf(to)), kind];
    }),
  );
}

/** `templateIds` の template graph の参照を新しい Sheet へ付け替える。切断面は genesis の `genesisSeq` 番まで */
export function remapTemplateRefs(
  refs: readonly TemplateRef[],
  ids: ImportIdMaps,
  genesisSeq: number,
): TemplateRef[] {
  return refs.map((ref) =>
    typeof ref === 'string'
      ? ref
      : {
          sheet: ids.sheet.get(ref.sheet) ?? ref.sheet,
          at: { [GENESIS_ACTOR]: genesisSeq },
        },
  );
}

/** File の中の template への参照をすべて付け替える (要素の id そのものは付け替え済みとする) */
export function remapTemplateReferences(
  file: GraphFile,
  ids: ImportIdMaps,
  genesisSeq: number,
): GraphFile {
  const remap = <T extends { properties?: Record<string, unknown> }>(
    element: T,
  ): T =>
    element.properties
      ? { ...element, properties: remapKindProperties(element.properties, ids) }
      : element;
  return {
    ...file,
    sheets: file.sheets.map((sheet) => ({
      ...sheet,
      ...(sheet.templateIds && {
        templateIds: remapTemplateRefs(sheet.templateIds, ids, genesisSeq),
      }),
      nodes: sheet.nodes.map(remap),
      edges: sheet.edges.map(remap),
    })),
  };
}
