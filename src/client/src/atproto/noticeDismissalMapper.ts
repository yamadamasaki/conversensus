/**
 * 閉じた通知 ↔ PDS レコード (step3 Phase 6 S6-0)
 *
 * 他の端末が書いたレコードを読むので、`judgmentMapper` と同じく**境界で検証する**。
 * 壊れたレコードは `null` にし、数えて警告するのは呼び出し側である。
 */

import { FileIdSchema } from '@conversensus/shared';
import { z } from 'zod';
import type { NoticeDismissal, NoticeKey } from '../notices/types';
import { batchRkeyPrefix } from './batchRkey';
import type { NoticeDismissalRecord } from './types';

const NoticeDismissalBodySchema = z.object({
  fileId: FileIdSchema,
  key: z.string().min(1),
  dismissedAt: z.string().datetime(),
});

/**
 * rkey は `<fileId>~<鍵の SHA-256 の 16 進>`。
 *
 * - **fileId が先頭**: batch の rkey と同じく、1 File 分を prefix 範囲取得できる
 *   (`batchRkeyPrefix` をそのまま使う)
 * - **鍵を hash する**: 鍵は `\u0000` を区切りに使い (`conflictKeyOf`)、プロパティ名
 *   (逆順ドメイン) を含めば長さも決まらない。rkey は使える文字と長さ (512) が限られる
 * - **決定的**: 同じ通知を 2 台が閉じても同じ rkey になり、record は 1 つに畳まれる
 */
export async function noticeDismissalRkey(
  fileId: NoticeDismissal['fileId'],
  key: NoticeKey,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(key),
  );
  const hex = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  return `${batchRkeyPrefix(fileId)}${hex}`;
}

export function noticeDismissalToRecord(
  dismissal: NoticeDismissal,
): Omit<NoticeDismissalRecord, '$type'> {
  return {
    fileId: dismissal.fileId,
    key: dismissal.key,
    dismissedAt: dismissal.dismissedAt,
  };
}

/** レコード値 → 閉じた通知。形が合わなければ `null` */
export function recordToNoticeDismissal(
  value: unknown,
): NoticeDismissal | null {
  const parsed = NoticeDismissalBodySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
