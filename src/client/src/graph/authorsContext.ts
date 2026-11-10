/**
 * node・edge を書いた人を、React Flow が描く部品へ降ろす (#354)
 *
 * node・edge の部品は React Flow が描くので props を渡せない。作者・表示名・agent の宣言と、表示の on/off を
 * context で降ろす。無ければ何も出さない (見るだけの pane など)。
 */

import type { AgentDeclaration, Did } from '@conversensus/shared';
import { createContext, useContext } from 'react';

export type AuthorsView = {
  /** 要素 (node・edge の id) の作者。作った人が先頭 */
  authorsOf: (elementId: string) => readonly Did[];
  /** DID → ハンドル名 (引けなければ DID) */
  labelOf: (did: Did) => string;
  /** DID の agent の宣言。まだ読めていなければ undefined */
  agentOf: (did: Did) => AgentDeclaration | undefined;
};

const AuthorsContext = createContext<AuthorsView | null>(null);

export const AuthorsProvider = AuthorsContext.Provider;

/** 作者の表示。出さないとき (context が無い・ヘッダで off) は null */
export function useAuthorsView(): AuthorsView | null {
  return useContext(AuthorsContext);
}
