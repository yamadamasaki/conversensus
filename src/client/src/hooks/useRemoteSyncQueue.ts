/**
 * useRemoteSyncQueue: ATProto セッションから remote 送信キューを組み立てる (step1 W3d5-5)
 *
 * 設計 §3.4 の「session が非 null のとき remote provider を構築する」を担う。
 * 生成物 (`RemoteSyncQueue`) は 2 箇所から使われるので App レベルで保持する:
 *   - tap (`useEventSyncTap` → `FanoutSyncProvider`) が enqueue する送信側
 *   - 同期ステータス UI (§3.7, W3d5-6) が pending を購読する表示側
 *
 * **未ログイン (session=null) なら null を返す** → tap は local-only のまま (W3d と完全一致・
 * 退行なし)。`SYNC_TO_REMOTE=false` でもログイン中の送信だけを止められる (config.ts)。
 *
 * キューはファイル単位ではなくセッション単位。ATProto の batch コレクションは repo 全体で
 * 1 つ (rkey=batchId) であり、宛先はファイルによらないため。
 */

import { useMemo } from 'react';
import type { AtprotoSession } from '../atproto';
import { batches } from '../atproto';
import { AtprotoSyncProvider } from '../atproto/atprotoSyncProvider';
import { RemoteSyncQueue } from '../atproto/remoteSyncQueue';
import { SYNC_TO_REMOTE } from '../config';

export function useRemoteSyncQueue(
  session: AtprotoSession | null,
  /** 未指定なら `SYNC_TO_REMOTE` 定数 (env)。テストは明示指定で on/off を固定する */
  enabled: boolean = SYNC_TO_REMOTE,
): RemoteSyncQueue | null {
  return useMemo(
    () =>
      session && enabled
        ? new RemoteSyncQueue({
            provider: new AtprotoSyncProvider({ batches }),
          })
        : null,
    // session が変われば別 repo への送信になるのでキューごと作り直す
    [session, enabled],
  );
}
