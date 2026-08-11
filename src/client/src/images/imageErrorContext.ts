/**
 * 画像の受け入れ失敗をユーザーへ伝える口 (ANA-117 S6)
 *
 * 画像を受け取る経路は canvas (`GraphEditor`) と既存ノード (`ImageNode`) の 2 つに
 * なったが、**表示するダイアログは 1 つ**でよい。`ImageNode` は React Flow が
 * `nodeTypes` 経由で描くので props を渡せないため、context で降ろす。
 *
 * `GraphEditorProps` を増やさない理由は S3 と同じである (既に 14 フィールドあり、
 * エラー表示は外の層の関心ではない)。
 */

import { createContext, useContext } from 'react';

export type ReportImageError = (message: string) => void;

/**
 * 既定は `console.error`。**握り潰さない** (設計 D7) ための最後の砦であり、
 * Provider を置き忘れてもユーザーの操作が黙って消えることはない。
 */
const ImageErrorContext = createContext<ReportImageError>((message) => {
  console.error('[image]', message);
});

export const ImageErrorProvider = ImageErrorContext.Provider;

export function useReportImageError(): ReportImageError {
  return useContext(ImageErrorContext);
}

/** 例外をユーザーに見せる文字列にする (Error 以外が飛んでくる経路もあるため) */
export function imageErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
