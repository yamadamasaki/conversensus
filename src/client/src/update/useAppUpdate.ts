/**
 * useAppUpdate: 新しい版が配られたかを見張る (#262)
 *
 * 見に行くのは、**タブが前に戻ったとき** (背後に置いた間に配られたことが多い) と、
 * 開きっぱなしのタブのための一定の間隔。オフラインの間は見に行かない。見つけたら、それより後は見に行かない —
 * 再読み込みするまで答えは変わらない。
 */

import { useCallback, useEffect, useState } from 'react';
import { type BuildId, fetchLatestBuildId } from './appUpdate';

/** 開きっぱなしのタブが見に行く間隔。配る頻度 (日に数回まで) に比べて十分短い */
export const UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000;

type Options = {
  /** このタブの build の印 */
  current: BuildId;
  /** 本番ビルドでだけ見張る (開発サーバには印が無い) */
  enabled: boolean;
  fetchLatest?: () => Promise<BuildId | null>;
  intervalMs?: number;
};

export type AppUpdate = {
  /** 配られている新しい版。無い、または利用者が閉じたなら null */
  available: BuildId | null;
  /**
   * 知らせを閉じる。**このタブではもう出さない** — 見つけた後は見に行かないので、さらに新しい版が
   * 配られても答えは同じ (再読み込みすれば、そのときの最新になる)
   */
  dismiss: () => void;
};

export function useAppUpdate({
  current,
  enabled,
  fetchLatest = fetchLatestBuildId,
  intervalMs = UPDATE_CHECK_INTERVAL_MS,
}: Options): AppUpdate {
  const [latest, setLatest] = useState<BuildId | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const found = latest !== null;

  useEffect(() => {
    if (!enabled || found) return;
    let disposed = false;
    const check = async () => {
      // オフラインなら見に行かない (失敗の記録をコンソールに積まない)
      if (navigator.onLine === false) return;
      const id = await fetchLatest();
      if (!disposed && id !== null && id !== current) setLatest(id);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    void check();
    const timer = setInterval(() => void check(), intervalMs);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, found, current, fetchLatest, intervalMs]);

  const dismiss = useCallback(() => setDismissed(true), []);
  return { available: dismissed ? null : latest, dismiss };
}
