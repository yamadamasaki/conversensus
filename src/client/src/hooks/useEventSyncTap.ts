/**
 * useEventSyncTap: dispatch された GraphEvent を操作ログへ流す tap を提供する
 * (step1 Phase 4 実配線 W2 / remote 配線 W3d5-5)
 *
 * ファイルごとに `EventSyncTap` を作り (別ファイルへ push しない)、
 * `useEventStore` の `onEvent` に渡すコールバックを返す。
 *
 * 宛先はローカル永続デーモン (`LocalServerSyncProvider`)。**remote キューが渡された
 * (= ATProto ログイン中) ときだけ** `FanoutSyncProvider` で包み、ローカル正典への push に
 * 加えて remote へも送る (W3d5-5)。remote は非ブロッキングなので、tap から見た挙動
 * (成功条件・保留・Lamport 復元) は local-only のときと変わらない。
 */

import type { FileId, SheetId } from '@conversensus/shared';
import { useCallback, useEffect, useMemo } from 'react';
import { FanoutSyncProvider } from '../atproto/fanoutSyncProvider';
import type { RemoteSyncQueue } from '../atproto/remoteSyncQueue';
import type { GraphEvent } from '../events/GraphEvent';
import { EventSyncTap } from '../sync/eventSyncTap';
import { LocalServerSyncProvider } from '../sync/localServerSyncProvider';
import type { SyncProvider } from '../sync/syncProvider';

export type UseEventSyncTapOptions = {
  /** remote 送信キュー。null/未指定なら local-only (未ログイン時と同じ挙動) */
  remoteQueue?: RemoteSyncQueue | null;
  /** テスト用: ローカル正典 provider の差し替え (既定 `LocalServerSyncProvider`) */
  createLocalProvider?: (fileId: FileId) => SyncProvider;
};

export function useEventSyncTap(
  fileId: FileId | null,
  { remoteQueue = null, createLocalProvider }: UseEventSyncTapOptions = {},
): (event: GraphEvent, sheetId?: SheetId) => void {
  // remote キューがあるときだけ fanout で包む。ローカル正典への経路は両者で同一。
  // (createLocalProvider を渡す場合は安定参照であること — 毎レンダー再生成すると tap が作り直される)
  const provider = useMemo(() => {
    if (!fileId) return null;
    const local = createLocalProvider
      ? createLocalProvider(fileId)
      : new LocalServerSyncProvider(fileId);
    return remoteQueue
      ? new FanoutSyncProvider({ local, remoteQueue, fileId })
      : local;
  }, [fileId, remoteQueue, createLocalProvider]);

  // fileId / provider が変われば新しい tap (clock/outbox を分離)。未オープン時は no-op。
  const tap = useMemo(
    () =>
      provider
        ? new EventSyncTap({
            provider,
            onError: (error) =>
              console.warn('[sync] batch flush failed:', error),
          })
        : null,
    [provider],
  );

  // catch-up (§3.6): ローカル正典にあって remote に無い batch を回収する。オフライン中に
  // best-effort push が落とした分をここで拾う。発火は 2 つ:
  //   - 起動時 (ファイルを開いた時点)
  //   - 再接続時 (`online` イベント / W3d5-7 確定)
  // `online` が発火しない障害 (PDS だけ落ちている等) は手動「今すぐ同期」(§3.7) と
  // 次回起動時 catch-up で回収する。定期リトライは catch-up 1 回 = 全件 pull (D2) の
  // コストを常時払うことになるため採らず、Phase 4d の subscribe/cursor 化へ委ねる。
  useEffect(() => {
    if (!(provider instanceof FanoutSyncProvider)) return;
    const catchUp = () =>
      provider
        .catchUpRemote()
        .catch((error) =>
          console.warn('[sync] remote catch-up failed:', error),
        );
    catchUp();
    window.addEventListener('online', catchUp);
    return () => window.removeEventListener('online', catchUp);
  }, [provider]);

  // content 経路は sheetId を渡す (W3c2)。structure 経路は省略 → file-level batch。
  return useCallback(
    (event: GraphEvent, sheetId?: SheetId) => tap?.record(event, sheetId),
    [tap],
  );
}
