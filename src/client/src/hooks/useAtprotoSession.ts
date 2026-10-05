import { useCallback, useEffect, useState } from 'react';
import type { AtprotoSession } from '../atproto';
import { login, logout, resumeSession } from '../atproto';

/** セッションの口。テストでは偽物を渡す */
export type AtprotoSessionApi = {
  resumeSession: typeof resumeSession;
  login: typeof login;
  logout: typeof logout;
};

const defaultApi: AtprotoSessionApi = { resumeSession, login, logout };

export function useAtprotoSession(api: AtprotoSessionApi = defaultApi) {
  const [session, setSession] = useState<AtprotoSession | null>(null);
  const [resuming, setResuming] = useState(true);

  useEffect(() => {
    api
      .resumeSession()
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setResuming(false));
  }, [api]);

  /**
   * オンラインに戻ったら、セッションの復元をやり直す (FPR 前 L-2)。
   *
   * 起動時の復元はネットワークを要るので、オフラインで起動するとログアウトした扱いになる
   * (その間の編集は未ログインの actor で書かれる)。ログインの情報は保存されているので、
   * 戻ったときに復元できれば**ログインし直さずに**ログイン済みに戻り、未ログインの編集の
   * 出し直し (L-1) に進む。ログイン中・自分でログアウトした後は何もしない (後者は保存された
   * セッションが無いので、復元しても null が返る)
   */
  useEffect(() => {
    if (session) return;
    const retry = () => {
      api
        .resumeSession()
        .then((s) => {
          if (s) setSession(s);
        })
        .catch(() => {});
    };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [api, session]);

  const handleLogin = useCallback(
    async (identifier: string, password?: string) => {
      const s = await api.login(identifier, password);
      setSession(s);
    },
    [api],
  );

  const handleLogout = useCallback(async () => {
    await api.logout();
    setSession(null);
  }, [api]);

  return { session, resuming, login: handleLogin, logout: handleLogout };
}
