/**
 * template の版の通知 (template-update D3、計画 K1・K5)
 *
 * 当てた template graph に新しい版がある・template graph が削除された、を知らせる。内容は op-log から
 * 求め直し (`appliedTemplateVersions`)、PDS に置くのは閉じたことだけ (ほかの通知と同じ、設計 Q4)。
 *
 * 純粋な関数だけを置く。state は `useTemplateNotices` が持つ。
 */

import {
  type AppliedTemplateVersion,
  type FileId,
  type SheetId,
  TEMPLATE_VERSION,
} from '@conversensus/shared';
import { templateNoticeKeyOf } from './noticeKeys';
import type { NoticeKey } from './types';

/** template の版の通知 1 つ */
export type TemplateNotice = {
  key: NoticeKey;
  fileId: FileId;
  /** 当てた先の Sheet */
  sheet: SheetId;
  /** template graph の Sheet */
  template: SheetId;
  /** 新しい版がある (`newer`) か、削除された (`deleted`) か */
  version: typeof TEMPLATE_VERSION.NEWER | typeof TEMPLATE_VERSION.DELETED;
  /** template の名前。読めなければ無い */
  templateName?: string;
};

/**
 * 当てた template の版から、出す通知を求める。最新のもの (`current`) と既読のものは出さない。
 * 並びは版の並び (Sheet の順) のまま
 */
export function templateNoticesOf(
  fileId: FileId,
  versions: readonly AppliedTemplateVersion[],
  dismissed: ReadonlySet<NoticeKey>,
): TemplateNotice[] {
  return versions.flatMap((v): TemplateNotice[] => {
    if (v.version === TEMPLATE_VERSION.CURRENT) return [];
    const key = templateNoticeKeyOf(v);
    if (dismissed.has(key)) return [];
    return [
      {
        key,
        fileId,
        sheet: v.sheet,
        template: v.template,
        version: v.version,
        ...(v.name !== undefined && { templateName: v.name }),
      },
    ];
  });
}
