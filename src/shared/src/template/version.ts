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
import type { FileId, Sheet, SheetId, TemplateSheetRef } from '../schemas';
import { appliedTemplateRefs } from './applied';
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

/** 文字列の短い指紋 (FNV-1a 32 bit、16 進)。暗号ではない — 同じ版かどうかを鍵で見分けるだけ */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** 当てた template 1 つの版 */
export type AppliedTemplateVersion = {
  /** 当てた先の Sheet */
  sheet: SheetId;
  /** template graph の Sheet */
  template: SheetId;
  version: TemplateVersion;
  /**
   * 先端の版の指紋 (`deleted` なら無い)。**どの端末でも同じ op-log から同じ値になる** — 通知の既読の鍵に
   * 入れて、閉じた通知を、先端がさらに変わるまで出さないために使う (D3)
   */
  tip?: string;
  /** template の名前 (先端の、消されていれば当てた版の)。読めなければ無い */
  name?: string;
};

/** 当てた template (`ref`) の版の状態と、先端の版の指紋と、template の名前を求める */
function versionWithTip(
  ref: TemplateSheetRef,
  trunk: Batch[],
  fileId: FileId,
): { version: TemplateVersion; tip?: string; name?: string } {
  const applied = templateAt(ref.sheet, ref.at, trunk, fileId);
  const tip = templateAt(ref.sheet, HEAD_CUT, trunk, fileId);
  if (tip === undefined) {
    // 消された後も名前を出せるよう、当てた版の名前を添える
    return {
      version: TEMPLATE_VERSION.DELETED,
      ...(applied !== undefined && { name: applied.name }),
    };
  }
  const tipText = canonical(tip);
  return {
    version:
      applied !== undefined && canonical(applied) === tipText
        ? TEMPLATE_VERSION.CURRENT
        : TEMPLATE_VERSION.NEWER,
    tip: fingerprint(tipText),
    name: tip.name,
  };
}

/** 当てた template (`ref`) の版の状態を、trunk の先端と比べて求める */
export function templateVersionOf(
  ref: TemplateSheetRef,
  trunk: Batch[],
  fileId: FileId,
): TemplateVersion {
  return versionWithTip(ref, trunk, fileId).version;
}

/**
 * File の Sheet に当たっている template graph すべての版 (D3 の通知の元)。作り込みの id は template graph
 * ではないので数えない。並びは Sheet の順、その中は `appliedTemplateRefs` の順
 */
export function appliedTemplateVersions(
  sheets: readonly Pick<Sheet, 'id' | 'templateIds' | 'properties'>[],
  trunk: Batch[],
  fileId: FileId,
): AppliedTemplateVersion[] {
  return sheets.flatMap((sheet) =>
    appliedTemplateRefs(sheet).flatMap((ref): AppliedTemplateVersion[] => {
      if (typeof ref === 'string') return [];
      const { version, tip, name } = versionWithTip(ref, trunk, fileId);
      return [
        {
          sheet: sheet.id,
          template: ref.sheet,
          version,
          ...(tip !== undefined && { tip }),
          ...(name !== undefined && { name }),
        },
      ];
    }),
  );
}
