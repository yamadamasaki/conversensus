/**
 * 認証の口 (step3 Phase 2 D7)
 *
 * 本番と開発は ATProto OAuth (`oauthAuth.ts`)。App 結合テストだけが、偽の PDS (`fakePds`) に
 * パスワードでログインする実装 (`passwordAuth.ts`) に差し替える — OAuth は PDS の同意画面を
 * 人が通るので、プロセスの中では再現できない。**パスワードの実装は本番の bundle に入らない**
 * (テストの道具だけが import する)。
 */

import type { Agent } from '@atproto/api';
import type { Did } from '@conversensus/shared';

export type AtprotoSession = {
  did: Did;
  handle: string;
};

/** ログインできた状態 */
export type SignedIn = {
  agent: Agent;
  session: AtprotoSession;
  /** 自分の PDS の URL (blob の生の URL を組むのに使う) */
  pdsUrl: string;
};

export interface AuthBackend {
  /** 既定の PDS (未ログインの Agent が向く先) */
  readonly pdsUrl: string;
  /** ログインにパスワードを要るか (OAuth は要らない — PDS の画面で入れる) */
  readonly needsPassword: boolean;
  /** 前のセッションを戻す。OAuth では、PDS から戻ってきたときの応答もここで受ける */
  resume(): Promise<SignedIn | null>;
  /**
   * ログインする。**OAuth では PDS へ移動するので、この Promise は解けない**
   * (戻ってきたら `resume` が受ける)
   */
  signIn(handle: string, password?: string): Promise<SignedIn>;
  signOut(): Promise<void>;
}
