import { describe, expect, mock, test } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { AtprotoSession } from '../atproto';
import { type AtprotoSessionApi, useAtprotoSession } from './useAtprotoSession';

const SESSION = {
  did: 'did:plc:alice',
  handle: 'alice.test',
} as AtprotoSession;

function apiOf(resume: () => Promise<AtprotoSession | null>) {
  const resumeSession = mock(resume);
  const api: AtprotoSessionApi = {
    resumeSession,
    login: mock(async () => SESSION),
    logout: mock(async () => {}),
  };
  return { api, resumeSession };
}

const goOnline = () =>
  act(() => {
    window.dispatchEvent(new Event('online'));
  });

describe('useAtprotoSession: オンラインに戻ったら復元をやり直す (FPR 前 L-2)', () => {
  test('オフラインで起動して復元できなくても、オンラインに戻って復元できればログイン済みになる', async () => {
    let online = false;
    const { api } = apiOf(async () => {
      if (!online) throw new Error('offline');
      return SESSION;
    });
    const { result } = renderHook(() => useAtprotoSession(api));
    await waitFor(() => expect(result.current.resuming).toBe(false));
    expect(result.current.session).toBeNull();

    online = true;
    await goOnline();
    await waitFor(() => expect(result.current.session).toEqual(SESSION));
  });

  test('ログイン中はやり直さない', async () => {
    const { api, resumeSession } = apiOf(async () => SESSION);
    const { result } = renderHook(() => useAtprotoSession(api));
    await waitFor(() => expect(result.current.session).toEqual(SESSION));
    await goOnline();
    expect(resumeSession).toHaveBeenCalledTimes(1);
  });

  test('自分でログアウトした後は、やり直しても保存されたセッションが無いのでログアウトのまま', async () => {
    let stored: AtprotoSession | null = SESSION;
    const { api } = apiOf(async () => stored);
    api.logout = mock(async () => {
      stored = null;
    });
    const { result } = renderHook(() => useAtprotoSession(api));
    await waitFor(() => expect(result.current.session).toEqual(SESSION));
    await act(() => result.current.logout());
    await goOnline();
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.session).toBeNull();
  });
});
