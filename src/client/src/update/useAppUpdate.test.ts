import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { BuildId } from './appUpdate';
import { useAppUpdate } from './useAppUpdate';

afterEach(cleanup);

const CURRENT = '1.1.0+aaa.1';
const NEWER = '1.2.0+bbb.2';
/** タイマーが鳴らないほど長い間隔。visibilitychange で見に行ったことを確かめるため */
const NEVER_MS = 60 * 60 * 1000;

/** 配られている印を差し替えられる取得口 */
function servedBuild(initial: BuildId | null) {
  const served = { id: initial, calls: 0 };
  const fetchLatest = async () => {
    served.calls += 1;
    return served.id;
  };
  return { served, fetchLatest };
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

afterEach(() => setVisibility('visible'));

describe('useAppUpdate (#262)', () => {
  test('同じ版が配られている間は知らせない', async () => {
    const { served, fetchLatest } = servedBuild(CURRENT);
    const { result } = renderHook(() =>
      useAppUpdate({
        current: CURRENT,
        enabled: true,
        fetchLatest,
        intervalMs: NEVER_MS,
      }),
    );
    await waitFor(() => expect(served.calls).toBe(1));
    expect(result.current.available).toBeNull();
  });

  test('開いた時点で新しい版が配られていれば知らせる', async () => {
    const { fetchLatest } = servedBuild(NEWER);
    const { result } = renderHook(() =>
      useAppUpdate({
        current: CURRENT,
        enabled: true,
        fetchLatest,
        intervalMs: NEVER_MS,
      }),
    );
    await waitFor(() => expect(result.current.available).toBe(NEWER));
  });

  test('背後にある間に配られた版に、前に戻ったときに気付く', async () => {
    const { served, fetchLatest } = servedBuild(CURRENT);
    const { result } = renderHook(() =>
      useAppUpdate({
        current: CURRENT,
        enabled: true,
        fetchLatest,
        intervalMs: NEVER_MS,
      }),
    );
    await waitFor(() => expect(served.calls).toBe(1));

    served.id = NEWER;
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(served.calls).toBe(1); // 背後に回ったときは見に行かない
    setVisibility('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(result.current.available).toBe(NEWER));
  });

  test('開きっぱなしのタブも、一定の間隔で見に行く', async () => {
    const { served, fetchLatest } = servedBuild(CURRENT);
    const { result } = renderHook(() =>
      useAppUpdate({
        current: CURRENT,
        enabled: true,
        fetchLatest,
        intervalMs: 10,
      }),
    );
    await waitFor(() => expect(served.calls).toBeGreaterThanOrEqual(1));
    served.id = NEWER;
    await waitFor(() => expect(result.current.available).toBe(NEWER));
  });

  test('見つけた後は見に行かない (再読み込みするまで答えは変わらない)', async () => {
    const { served, fetchLatest } = servedBuild(NEWER);
    const { result } = renderHook(() =>
      useAppUpdate({
        current: CURRENT,
        enabled: true,
        fetchLatest,
        intervalMs: 10,
      }),
    );
    await waitFor(() => expect(result.current.available).toBe(NEWER));
    const calls = served.calls;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(served.calls).toBe(calls);
  });

  test('読めない (null) ときは知らせない', async () => {
    const { served, fetchLatest } = servedBuild(null);
    const { result } = renderHook(() =>
      useAppUpdate({
        current: CURRENT,
        enabled: true,
        fetchLatest,
        intervalMs: NEVER_MS,
      }),
    );
    await waitFor(() => expect(served.calls).toBe(1));
    expect(result.current.available).toBeNull();
  });

  test('閉じたら、このタブではもう出さない', async () => {
    const { fetchLatest } = servedBuild(NEWER);
    const { result } = renderHook(() =>
      useAppUpdate({
        current: CURRENT,
        enabled: true,
        fetchLatest,
        intervalMs: NEVER_MS,
      }),
    );
    await waitFor(() => expect(result.current.available).toBe(NEWER));
    act(() => result.current.dismiss());
    expect(result.current.available).toBeNull();
  });

  test('オフラインの間は見に行かない', async () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => false,
    });
    try {
      const { served, fetchLatest } = servedBuild(NEWER);
      renderHook(() =>
        useAppUpdate({
          current: CURRENT,
          enabled: true,
          fetchLatest,
          intervalMs: 10,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(served.calls).toBe(0);
    } finally {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        get: () => true,
      });
    }
  });

  test('無効 (開発サーバ) なら見に行かない', async () => {
    const { served, fetchLatest } = servedBuild(NEWER);
    const { result } = renderHook(() =>
      useAppUpdate({
        current: CURRENT,
        enabled: false,
        fetchLatest,
        intervalMs: 10,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(served.calls).toBe(0);
    expect(result.current.available).toBeNull();
  });
});
