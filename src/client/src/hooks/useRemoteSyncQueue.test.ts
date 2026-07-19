import { afterEach, describe, expect, it, mock } from 'bun:test';

// zod を先にモックする (../atproto 経由で推移的に読まれる)
const zodProxy: Record<string, unknown> = new Proxy(() => zodProxy, {
  get: () => zodProxy,
  apply: () => zodProxy,
}) as unknown as Record<string, unknown>;

mock.module('zod', () => ({
  z: zodProxy,
  default: zodProxy,
}));

const { renderHook, cleanup } = await import('@testing-library/react');
const { useRemoteSyncQueue } = await import('./useRemoteSyncQueue');
type AtprotoSession = import('../atproto').AtprotoSession;

const SESSION = { did: 'did:plc:alice' } as AtprotoSession;

afterEach(cleanup);

describe('useRemoteSyncQueue', () => {
  it('未ログイン (session=null) なら null → tap は local-only (W3d と同一)', () => {
    const { result } = renderHook(() => useRemoteSyncQueue(null, true));
    expect(result.current).toBeNull();
  });

  it('ログイン中はキューを作る', () => {
    const { result } = renderHook(() => useRemoteSyncQueue(SESSION, true));
    expect(result.current).not.toBeNull();
    expect(result.current?.pendingCount).toBe(0);
  });

  it('SYNC_TO_REMOTE=false ならログイン中でも送信しない (安全弁)', () => {
    const { result } = renderHook(() => useRemoteSyncQueue(SESSION, false));
    expect(result.current).toBeNull();
  });

  it('同じ session の再レンダーではキューを作り直さない (未送信を失わない)', () => {
    const { result, rerender } = renderHook(() =>
      useRemoteSyncQueue(SESSION, true),
    );
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
