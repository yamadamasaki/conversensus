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

import type { Actor, Batch, FileId, SheetId } from '@conversensus/shared';
import { useCallback, useEffect, useMemo } from 'react';
import { pushReceivedBatches } from '../api';
import { FanoutSyncProvider } from '../atproto/fanoutSyncProvider';
import type { RemoteSyncQueue } from '../atproto/remoteSyncQueue';
import type { GraphEvent } from '../events/GraphEvent';
import { EventSyncTap } from '../sync/eventSyncTap';
import { LocalServerSyncProvider } from '../sync/localServerSyncProvider';
import {
  type ReceiveRemoteResult,
  receiveRemoteBatches,
} from '../sync/receiveRemoteBatches';
import type { SyncProvider } from '../sync/syncProvider';

/**
 * 受信通知に添える tap の待ち合わせ点 (Phase 4e-3, critic MED3)。
 * `settled` はローカル drain (flushChain) の完了を待つ — remote は待たない。
 * `pending` は未 push 件数。`settled()` はローカル push 失敗時も resolve するため、
 * 再 projection の可否は `pending() === 0` で判定する (reprojectAfterReceive)。
 */
export type TapHandle = {
  settled: () => Promise<void>;
  pending: () => number;
};

export type UseEventSyncTapOptions = {
  /** remote 送信キュー。null/未指定なら local-only (未ログイン時と同じ挙動) */
  remoteQueue?: RemoteSyncQueue | null;
  /** この端末の操作主体 `<did>#<deviceId>` (Phase 4d-2)。batch の actor になる */
  actor: Actor;
  /** テスト用: ローカル正典 provider の差し替え (既定 `LocalServerSyncProvider`) */
  createLocalProvider?: (fileId: FileId) => SyncProvider;
  /**
   * テスト用: 受信の書き込み口の差し替え (既定 `pushReceivedBatches`)。
   * **安定参照であること** — 毎レンダー再生成すると受信 effect が張り直される。
   */
  appendReceived?: (fileId: FileId, batches: Batch[]) => Promise<number>;
  /**
   * 受信がローカル正典へ着地した (`appended > 0`) ときの通知 (Phase 4e-3)。
   * 画面反映 (再 projection → activeFile 差し替え) の起点。tap の待ち合わせ点を添える。
   * **安定参照であること** (appendReceived と同じ理由)。
   */
  onReceived?: (
    fileId: FileId,
    result: ReceiveRemoteResult,
    tap: TapHandle,
  ) => void;
};

export function useEventSyncTap(
  fileId: FileId | null,
  {
    remoteQueue = null,
    actor,
    createLocalProvider,
    appendReceived = pushReceivedBatches,
    onReceived,
  }: UseEventSyncTapOptions,
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
            actor,
            onError: (error) =>
              console.warn('[sync] batch flush failed:', error),
          })
        : null,
    [provider, actor],
  );

  // catch-up (§3.6): ローカル正典にあって remote に無い batch を回収する。オフライン中に
  // best-effort push が落とした分をここで拾う。発火は 2 つ:
  //   - 起動時 (ファイルを開いた時点)
  //   - 再接続時 (`online` イベント / W3d5-7 確定)
  // `online` が発火しない障害 (PDS だけ落ちている等) は手動「今すぐ同期」(§3.7) と
  // 次回起動時 catch-up で回収する。定期リトライは catch-up 1 回 = 全件 pull (D2) の
  // コストを常時払うことになるため採らず、Phase 4d の subscribe/cursor 化へ委ねる。
  //
  // **受信 (Phase 4d-5) も同じ契機に相乗りする** (§3.4)。送信 catch-up と受信は
  // 「remote と突き合わせて差分を埋める」同じ性質の操作なので、発火経路を分けない。
  // 送信の失敗が受信を止めないよう、両者は独立に catch する。
  useEffect(() => {
    if (!(provider instanceof FanoutSyncProvider)) return;
    if (!fileId || !remoteQueue || !tap) return;

    const syncBoth = () => {
      provider
        .catchUpRemote()
        .catch((error) =>
          console.warn('[sync] remote catch-up failed:', error),
        );
      // 受信は fanout を通さない (echo ループ回避, §3.3a)。ローカル正典への直書き。
      receiveRemoteBatches(fileId, {
        pullRemote: () => remoteQueue.pullRemote(),
        appendReceived,
        observeRemote: (clock) => tap.observeRemote(clock),
      })
        .then((result) => {
          if (result.appended > 0) {
            console.info(
              `[sync] received ${result.received} remote batch(es), ` +
                `${result.appended} new`,
            );
            // 画面反映の起点 (Phase 4e-3)。着地していない受信 (appended=0) では
            // 呼ばない — 再 projection しても画面は変わらない。
            onReceived?.(fileId, result, {
              settled: () => tap.settled(),
              pending: () => tap.pending,
            });
          }
        })
        .catch((error) => console.warn('[sync] remote receive failed:', error));
    };

    syncBoth();
    window.addEventListener('online', syncBoth);
    return () => window.removeEventListener('online', syncBoth);
  }, [provider, fileId, remoteQueue, tap, appendReceived, onReceived]);

  // content 経路は sheetId を渡す (W3c2)。structure 経路は省略 → file-level batch。
  return useCallback(
    (event: GraphEvent, sheetId?: SheetId) => tap?.record(event, sheetId),
    [tap],
  );
}
