/**
 * 既にある Sheet に後から当てられる template graph (#355、計画 apply-template-355.md)
 *
 * sheet の「…」の入口 (出すかどうか) と、開くダイアログ (並べるもの) が同じ答えを使う。
 */

import {
  appliedTemplateSheetIds,
  METAGRAPH_SHEET_KIND,
  type Sheet,
  type SheetId,
  sheetKindOf,
  TEMPLATE_SHEET_KIND,
} from '@conversensus/shared';

/**
 * `target` に後から当てられる template graph (File の中の順)。
 *
 * - 既に当たっているもの (作るときのものも、後から当てたものも) は除く
 * - template graph・metagraph の Sheet には当てない (種類を持つ node を置く所ではない)
 */
export function applicableTemplateGraphs(
  sheets: readonly Sheet[],
  target: Sheet,
): Sheet[] {
  const kind = sheetKindOf(target);
  if (kind === TEMPLATE_SHEET_KIND || kind === METAGRAPH_SHEET_KIND) return [];
  const applied = appliedTemplateSheetIds(target);
  return sheets.filter(
    (s) =>
      sheetKindOf(s) === TEMPLATE_SHEET_KIND && !applied.has(s.id as SheetId),
  );
}
