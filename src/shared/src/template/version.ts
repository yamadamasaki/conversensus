/**
 * 当てた template の版 (template-update 段 2 D2・D3、計画 K1・K5)
 *
 * 当てた template は切断面 `at` で読む (`resolveTemplates`)。template graph がその後に書き換えられたか、
 * 消されたかを、**trunk の先端で読んだ template と比べて**決める。
 *
 * - **比べるのは template graph そのものではなく、そこから読んだ種類** (`templateFromSheet`)。node を
 *   動かしただけ・種類にならない node を足しただけでは、適用先から見て何も変わらないので「新しい版」に
 *   しない。`at` は File 全体の trunk の切断面なので、op があるかどうかでは決められない (ほかの Sheet の
 *   編集でも進む)
 * - 先端で template graph が無い (消された・種別が template でなくなった) なら `deleted`。適用先は
 *   止めた版のまま動く (K5)
 */

import { type Cut, HEAD_CUT, projectAddress } from '../events/address';
import { sheetKindOf, TEMPLATE_SHEET_KIND } from '../events/sheetKind';
import type { Batch } from '../events/unified';
import type { FileId, SheetId, TemplateSheetRef } from '../schemas';
import { templateFromSheet, templateIdOf } from './fromSheet';
import type { Template } from './types';

/** 当てた template の版の状態 */
export const TEMPLATE_VERSION = {
  /** 当てた版が先端と同じ */
  CURRENT: 'current',
  /** 先端に新しい版がある */
  NEWER: 'newer',
  /** 先端で template graph が無い */
  DELETED: 'deleted',
} as const;
export type TemplateVersion =
  (typeof TEMPLATE_VERSION)[keyof typeof TEMPLATE_VERSION];

/** 切断面 `cut` (`HEAD_CUT` なら先端) で template graph を読む。template graph でなければ `undefined` */
function templateAt(
  templateSheet: SheetId,
  cut: Cut,
  trunk: Batch[],
  fileId: FileId,
): Template | undefined {
  const sheet = projectAddress(
    {
      fileId,
      sheetId: templateSheet,
      branchId: null,
      cut,
    },
    { trunk },
  );
  if (!sheet || sheetKindOf(sheet) !== TEMPLATE_SHEET_KIND) return undefined;
  return templateFromSheet(sheet, templateIdOf(templateSheet));
}

/**
 * 値を、オブジェクトのキーを並べた JSON にする。種類の並びは op-log の畳み込みで決まるが、オブジェクトの
 * キーの順は書いた順に依るので、そろえてから比べる
 */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : v,
  );
}

/** 当てた template (`ref`) の版の状態を、trunk の先端と比べて求める */
export function templateVersionOf(
  ref: TemplateSheetRef,
  trunk: Batch[],
  fileId: FileId,
): TemplateVersion {
  const tip = templateAt(ref.sheet, HEAD_CUT, trunk, fileId);
  if (tip === undefined) return TEMPLATE_VERSION.DELETED;
  const applied = templateAt(ref.sheet, ref.at, trunk, fileId);
  return applied !== undefined && canonical(applied) === canonical(tip)
    ? TEMPLATE_VERSION.CURRENT
    : TEMPLATE_VERSION.NEWER;
}
