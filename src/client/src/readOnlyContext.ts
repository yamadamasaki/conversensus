/**
 * その File が読み取り専用かを画面へ降ろす口 (step2 Phase 2 S6)
 *
 * いまのところ理由は 1 つ — **再参加した後、同期が済むまで**である
 * (`syncObligation`)。理由が増えたらここに足す。
 *
 * **context で降ろす。**`ImageNode` などは React Flow が `nodeTypes` 経由で描くので
 * props が届かず、途中の層はこの値に用が無い (`blobOriginContext` と同じ理由)。
 * `GraphEditorProps` も増やさない。
 */

import { createContext, useContext } from 'react';

/** 既定は編集できる。**Provider を置き忘れても操作を奪わない** */
const ReadOnlyContext = createContext(false);

export const ReadOnlyProvider = ReadOnlyContext.Provider;

export function useReadOnly(): boolean {
  return useContext(ReadOnlyContext);
}
