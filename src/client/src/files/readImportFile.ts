/**
 * import で選ばれた `.conversensus` を読んで解釈する。
 *
 * 左サイドバーの「import」と、File が 1 つも無いときの空の状態 (visual language §9.1) の
 * 2 か所から使う。どちらも結果を人に言う必要があるので、**失敗の理由は文として返す**。
 * 出し方 (どのダイアログか) は呼び出し側が決める。
 */

import {
  type ConversensusFile,
  parseConversensusFile,
} from '@conversensus/shared';
import { messages } from '../i18n/messages';

export type ImportReadResult =
  | { ok: true; data: ConversensusFile }
  | { ok: false; message: string };

export async function readImportFile(file: Blob): Promise<ImportReadResult> {
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    // 読めなかったとき (JSON でない・読み込みの失敗)
    return { ok: false, message: messages().importErrors.readFailed };
  }
  // 旧版の移行を含めた解釈は shared に 1 本化してある (server も同じ関数を使う)
  const parsed = parseConversensusFile(json);
  if (parsed.success) return { ok: true, data: parsed.data };
  const details = parsed.error.errors
    .map((err) => `${err.path.join('.')}: ${err.message}`)
    .join('\n');
  return { ok: false, message: messages().importErrors.invalidFormat(details) };
}
