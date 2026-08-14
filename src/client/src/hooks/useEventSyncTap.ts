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

import type {
  Actor,
  Batch,
  FileId,
  Lamport,
  SheetId,
} from '@conversensus/shared';
import { useCallback, useEffect, useMemo, useRef } from 'react';
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

/**
 * merge の再スタンプ用に公開する clock 操作 (step1 Phase 5 p5-4)。
 * tap が作り直されても同じ参照で最新の tap を見るよう ref 経由で束ねる。
 */
export type TapClock = {
  /** 下限を引き上げる (`seed` 意味論: +1 しない) */
  seed: (floor: Lamport) => void;
  /** 次の clock を発番する */
  tick: () => Lamport;
};

export type UseEventSyncTapOptions = {
  /** remote 送信キュー。null/未指定なら local-only (未ログイン時と同じ挙動) */
  remoteQueue?: RemoteSyncQueue | null;
  /**
   * この op-log の発番下限 (branch のみ: 分岐点 `base.at`)。
   * 空の branch op-log でも base より後から発番させる (`EventSyncTap.clockFloor`)。
   */
  clockFloor?: Lamport;
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

export type UseEventSyncTapResult = {
  /** dispatch された event を op-log へ流す (content 経路は sheetId 付き) */
  record: (event: GraphEvent, sheetId?: SheetId) => void;
  /** merge の再スタンプ用 clock (§p5-4)。tap 未生成なら呼び出しは失敗する */
  clock: TapClock;
  /**
   * これまでに record した event の drain 完了を待つ (§p5-4)。
   * **op-log を読み直す操作 (commit / merge) の前に必ず待つ** — record は非同期に
   * flush するので、待たないと直前の編集が commit のオフセットに入らなかったり、
   * merge で trunk に載らないまま branch が MERGED になったりする。
   */
  settled: () => Promise<void>;
  /**
   * remote と突き合わせて差分を埋める (送信の catch-up + 受信)。
   *
   * ファイルを開いたときと `online` で自動的に走るが, **利用者が明示的に
   * 呼べるようにも公開している** — 開いている間に他所で起きた変更を取りに行く手段が
   * 他に無いためである (GitHub #202)。完了を待てるので「同期中…」の表示に使える。
   */
  syncNow: () => Promise<void>;
};

export function useEventSyncTap(
  fileId: FileId | null,
  {
    remoteQueue = null,
    actor,
    clockFloor,
    createLocalProvider,
    appendReceived = pushReceivedBatches,
    onReceived,
  }: UseEventSyncTapOptions,
): UseEventSyncTapResult {
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
            clockFloor,
            onError: (error) =>
              console.warn('[sync] batch flush failed:', error),
          })
        : null,
    [provider, actor, clockFloor],
  );

  // clock は tap の作り直しをまたいで同じ参照でいてほしい (merge の deps に渡すため)
  const tapRef = useRef(tap);
  tapRef.current = tap;
  const clock = useMemo<TapClock>(
    () => ({
      seed: (floor) => tapRef.current?.clockControl.seed(floor),
      // tap が無いときに 0 を返すと **clock 0 の batch が op-log に入る**。
      // 発番できないことは呼び出し側の配線ミスなので、黙って進めず落とす。
      tick: () => {
        const tap = tapRef.current;
        if (!tap)
          throw new Error('clock.tick: tap が未生成です (fileId が null)');
        return tap.clockControl.tick();
      },
    }),
    [],
  );

  // tap が無い (未オープン) ときは待つものが無いので即 resolve
  const settled = useCallback(
    () => tapRef.current?.settled() ?? Promise.resolve(),
    [],
  );

  // catch-up (§3.6): ローカル正典にあって remote に無い batch を回収する。オフライン中に
  // best-effort push が落とした分をここで拾う。
  //
  // **受信 (Phase 4d-5) も同じ契機に相乗りする** (§3.4)。送信 catch-up と受信は
  // 「remote と突き合わせて差分を埋める」同じ性質の操作なので、発火経路を分けない。
  //
  // 定期取得は採らない — 1 回あたり remote 取得 1 往復のコストを常時払うことになる。
  // 自動反映は Jetstream 購読へ委ね (GitHub #202)、それまでは**人が要求したときに
  // 取りに行ける**ようにしておく (契機 3)。
  /**
   * remote と突き合わせて差分を埋める (送信の catch-up + 受信)。
   *
   * **契機は 3 つある** (§3.4 + ANA-202):
   *
   * 1. ファイルを開いたとき (下の effect)
   * 2. `online` イベント (再接続)
   * 3. **利用者が「今すぐ同期」を押したとき** (`SyncStatusIndicator`)
   *
   * 3 を足したのは, 1 と 2 だけでは**開いている間に他所で起きた変更を取りに行く手段が
   * 無かった**ためである (GitHub #202)。定期取得は 1 回あたり remote 取得 1 往復の
   * コストを常時払うので採らず, **人が要求したときだけ**取りに行く。
   *
   * 送信と受信は**独立に catch する** — 送信の失敗が受信を止めないようにする。
   * 呼び出し側が完了を待てるよう Promise を返す (ボタンの「同期中…」表示に使う)。
   */
  const syncNow = useCallback(async (): Promise<void> => {
    if (!(provider instanceof FanoutSyncProvider)) return;
    if (!fileId || !remoteQueue || !tap) return;

    await Promise.all([
      provider
        .catchUpRemote()
        .catch((error) =>
          console.warn('[sync] remote catch-up failed:', error),
        ),
      // 受信は fanout を通さない (echo ループ回避, §3.3a)。ローカル正典への直書き。
      receiveRemoteBatches(fileId, {
        // 取得はファイル単位 (Phase 7 p7-2)。repo 全体を落として捨てる形を止めた
        pullRemoteForFile: (id) => remoteQueue.pullRemoteForFile(id),
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
        .catch((error) => console.warn('[sync] remote receive failed:', error)),
    ]);
  }, [provider, fileId, remoteQueue, tap, appendReceived, onReceived]);

  useEffect(() => {
    void syncNow();
    const onOnline = () => void syncNow();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [syncNow]);

  // content 経路は sheetId を渡す (W3c2)。structure 経路は省略 → file-level batch。
  const record = useCallback(
    (event: GraphEvent, sheetId?: SheetId) => tap?.record(event, sheetId),
    [tap],
  );

  return { record, clock, settled, syncNow };
}
