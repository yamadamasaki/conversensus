/**
 * パスワードによる認証 (step3 Phase 2 D7) — **App 結合テストと、常駐の agent (headless) 専用**
 *
 * `com.atproto.server.createSession` でログインする。ブラウザの本番と開発は OAuth (`oauthAuth.ts`) で、
 * ここはブラウザの本番の bundle に入らない (`testing/appWorld.ts` だけが使う)。
 *
 * 常駐の agent (agent 段 5、設計 A2') は **app password** をここに渡す。public client の OAuth は
 * 最長 2 週間で同意し直しになるが、app password は取り消すまで失効しない。
 *
 * セッションは localStorage に置く。App 結合の「端末」は localStorage を控えて差し替えるので、
 * 端末を戻せばセッションも戻る。
 */

import type { AtpSessionData, AtpSessionEvent } from '@atproto/api';
import { AtpAgent } from '@atproto/api';
import type { Did } from '@conversensus/shared';
import type { AuthBackend, SignedIn } from './auth';

const SESSION_STORAGE_KEY = 'atproto_session';

export function passwordAuth(pdsUrl: string): AuthBackend {
  let agent: AtpAgent | null = null;
  const getAgent = () => {
    agent ??= new AtpAgent({
      service: pdsUrl,
      persistSession: (
        _evt: AtpSessionEvent,
        s: AtpSessionData | undefined,
      ) => {
        if (s) localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(s));
        else localStorage.removeItem(SESSION_STORAGE_KEY);
      },
    });
    return agent;
  };
  const signedIn = (a: AtpAgent): SignedIn | null =>
    a.session
      ? {
          agent: a,
          session: { did: a.session.did as Did, handle: a.session.handle },
          pdsUrl,
        }
      : null;

  return {
    pdsUrl,
    needsPassword: true,
    resume: async () => {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return null;
      const a = getAgent();
      await a.resumeSession(JSON.parse(raw) as AtpSessionData).catch(() => {});
      const result = signedIn(a);
      if (!result) localStorage.removeItem(SESSION_STORAGE_KEY);
      return result;
    },
    signIn: async (handle, password) => {
      const a = getAgent();
      await a.login({ identifier: handle, password: password ?? '' });
      const result = signedIn(a);
      if (!result) throw new Error('ログインできなかった');
      return result;
    },
    signOut: async () => {
      await agent?.logout().catch(() => {});
      localStorage.removeItem(SESSION_STORAGE_KEY);
      agent = null;
    },
  };
}
