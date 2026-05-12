import { useCallback, useEffect, useState } from 'react';
import type { AtprotoSession } from '../atproto';
import { login, logout, resumeSession } from '../atproto';

export function useAtprotoSession() {
  const [session, setSession] = useState<AtprotoSession | null>(null);
  const [resuming, setResuming] = useState(true);

  useEffect(() => {
    resumeSession()
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setResuming(false));
  }, []);

  const handleLogin = useCallback(
    async (identifier: string, password: string) => {
      const s = await login(identifier, password);
      setSession(s);
    },
    [],
  );

  const handleLogout = useCallback(async () => {
    await logout();
    setSession(null);
  }, []);

  return { session, resuming, login: handleLogin, logout: handleLogout };
}
