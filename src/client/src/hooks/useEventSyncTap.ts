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
import { didFromActor } from '@conversensus/shared';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { pushReceivedBatches } from '../api';
import { FanoutSyncProvider } from '../atproto/fanoutSyncProvider';
import type { RemoteSyncQueue } from '../atproto/remoteSyncQueue';
import { SYNC_POLL_INTERVAL_MS } from '../config';
import type { GraphEvent } from '../events/GraphEvent';
import { maxJudgmentClock } from '../sync/appendJudgment';
import { EventSyncTap } from '../sync/eventSyncTap';
import { LocalServerSyncProvider } from '../sync/localServerSyncProvider';
import { receiveParticipantBatches } from '../sync/receiveParticipantBatches';
import { receiveRemoteBatches } from '../sync/receiveRemoteBatches';
import type { RosterSource } from '../sync/rosterSource';
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
  /**
   * 定期同期の間隔 (ミリ秒, step2 Phase 2 S4)。既定は `SYNC_POLL_INTERVAL_MS`。
   * **テストが時計を縮めるための口である** — 本番で変える想定は無い。
   */
  pollIntervalMs?: number;
  /**
   * 名簿の供給元 (step2 Phase 2 S2)。**渡されたときだけ多アクタ同期が走る**。
   *
   * 省略すると自分の repo だけを見る step1 の挙動になる。「読む順序は名簿 → グラフに
   * 固定される」ので、他 actor の op-log を読むにはまず名簿が要る。
   */
  roster?: RosterSource | null;
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
   *
   * **1 サイクルに 1 回である** (step2 Phase 2 S2)。自分の repo と参加者の repo の
   * 両方を読んだ合計を渡す — 相手ごとに呼ぶと、参加者の数だけ再 projection が走る。
   */
  onReceived?: (
    fileId: FileId,
    result: ReceivedSummary,
    tap: TapHandle,
  ) => void;
};

/**
 * 1 サイクルの受信の合計 (step2 Phase 2 S2)。
 *
 * Phase 2 で受信の脚が 2 本 (自分の repo / 参加者の repo) になり、結果の型も 2 つに
 * なったので、通知はその共通部分に絞る。**消費者 (`reprojectAfterReceive`) は
 * 「着地したか」しか見ない** ので、これで足りる。
 */
export type ReceivedSummary = {
  /** 取り込みの対象にした batch 数 */
  received: number;
  /** ローカル正典に**新規に**追記された batch 数 */
  appended: number;
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
    roster = null,
    pollIntervalMs = SYNC_POLL_INTERVAL_MS,
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
  /**
   * remote と突き合わせて差分を埋める (送信の catch-up + 受信)。
   *
   * **契機は 4 つある** (§3.4 + ANA-202 + step2 Phase 2 S4):
   *
   * 1. ファイルを開いたとき (下の effect)
   * 2. `online` イベント (再接続)
   * 3. 利用者が「今すぐ同期」を押したとき (`SyncStatusIndicator`)
   * 4. **定期ポーリング** (step2 Phase 2 S4)
   *
   * 3 を足したのは, 1 と 2 だけでは**開いている間に他所で起きた変更を取りに行く手段が
   * 無かった**ためである (GitHub #202)。step1 では 4 を採らなかった — 1 回あたり
   * remote 取得 1 往復のコストを常時払うことになるためで, 自動反映は Jetstream 購読へ
   * 委ねる予定だった。**step2 でこれを覆す**: 多アクタでは「相手の編集が見えるまでの
   * 遅れ」がそのまま体験になるので, 人が押すまで待つ形は成立しない。
   *
   * 送信と受信は**独立に catch する** — 送信の失敗が受信を止めないようにする。
   * 呼び出し側が完了を待てるよう Promise を返す (ボタンの「同期中…」表示に使う)。
   *
   * **走っているサイクルがあれば、それに相乗りする** (S4)。契機が 4 つに増えたので、
   * ポーリングと手動と `visibilitychange` が重なる場面が普通に起きる。2 本走らせても
   * べき等なので壊れないが, 遅い PDS では要求が積み上がる。
   */
  const runningSync = useRef<Promise<void> | null>(null);

  const syncNow = useCallback((): Promise<void> => {
    if (!(provider instanceof FanoutSyncProvider)) return Promise.resolve();
    if (!fileId || !remoteQueue || !tap) return Promise.resolve();
    // 走っているサイクルに相乗りする (S4)。契機が 4 つあるので重なりは常態である
    const running = runningSync.current;
    if (running) return running;

    /**
     * 受信の 2 本の脚 (step2 Phase 2 S2)。
     *
     * **順序が意味を持つ。**自分の repo は名簿によらず読めるので先に読む。参加者の repo は
     * 「読む順序は名簿 → グラフに固定される」ので、名簿を読んでからでないと読めない。
     *
     * 名簿が読めなくても自分の分は取り込み済である — 相手の PDS が応答しないことは
     * 正常に起こるので、そこで自分の別端末の編集まで止めない。
     */
    const receiveAll = async (): Promise<ReceivedSummary> => {
      // 受信は fanout を通さない (echo ループ回避, §3.3a)。ローカル正典への直書き。
      const own = await receiveRemoteBatches(fileId, {
        // 取得はファイル単位 (Phase 7 p7-2)。repo 全体を落として捨てる形を止めた
        pullRemoteForFile: (id) => remoteQueue.pullRemoteForFile(id),
        appendReceived,
        observeRemote: (clock) => tap.observeRemote(clock),
      });
      if (!roster) return own;

      const seen = await roster.read(fileId);

      // ⚠️ **判断ログの clock も観測する** (2026-09-05 実機で発覚)。
      //
      // 判断ログとグラフの op-log は clock 空間を共有すると決めた (Phase 1) が、
      // **tap はグラフ側の最大値からしか seed していなかった**。承認 (`accept`) は
      // 判断ログの最大値 + 1 で発番されるので、承認直後にこの File を開くと
      // tap の clock は承認より小さいところから始まる。すると**参加した本人の最初の
      // 編集が「参加より前」に見え**、相手側の期間フィルタが落とす。
      //
      // Lamport の受信規則そのものである — 承認は自分の次の編集に因果的に先行する。
      //
      // **開いてから最初のサイクルが終わるまでの窓は残る。**その間に編集すると
      // 低い clock が振られる。判断ログはローカルに無く PDS を読まないと分からない
      // ので、tap の復元 (ローカル正典の max) だけでは埋められない。契機 1 (開いた
      // とき) がすぐ走るので実際には狭いが、構造として残っていることは記しておく。
      tap.observeRemote(maxJudgmentClock(seen.batches));

      const participation = seen.participation;
      const others = await receiveParticipantBatches(
        fileId,
        participation,
        didFromActor(actor),
        {
          pullRemoteForFile: (id, repo) =>
            remoteQueue.pullRemoteForFile(id, repo),
          appendReceived,
          observeRemote: (clock) => tap.observeRemote(clock),
        },
      );
      if (others.readRepos.length > 0 || others.outsidePeriod > 0) {
        console.info(
          `[sync] read ${others.readRepos.length} participant repo(s): ` +
            `${others.received} batch(es) in period, ${others.appended} new, ` +
            `${others.outsidePeriod} outside period`,
        );
      }
      return {
        received: own.received + others.received,
        appended: own.appended + others.appended,
      };
    };

    const cycle = Promise.all([
      provider
        .catchUpRemote()
        .catch((error) =>
          console.warn('[sync] remote catch-up failed:', error),
        ),
      receiveAll()
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
    ])
      .then(() => undefined)
      // **自分が最新のときだけ外す。**失敗したサイクルを残すと、以後の呼び出しが
      // 同じ失敗を受け取り続ける (`rosterSource` と同じ判断)
      .finally(() => {
        if (runningSync.current === cycle) runningSync.current = null;
      });
    runningSync.current = cycle;
    return cycle;
  }, [
    provider,
    fileId,
    remoteQueue,
    tap,
    roster,
    actor,
    appendReceived,
    onReceived,
  ]);

  // 同期の契機 (§3.4 + step2 Phase 2 S4)。
  //
  // **定期ポーリングは「前回の完了から N ミリ秒」で回す。**`setInterval` にすると
  // 遅い PDS で要求が積み上がる (前のサイクルが終わる前に次が始まる)。
  //
  // 止める条件を 2 つ持つ。どちらも「見ていない画面のために相手の PDS を叩かない」
  // ためである。
  //
  //   - **タブが不可視のとき** (`document.hidden)。裏で開いたままのタブが 30 秒ごとに
  //     参加者全員の repo を読み続けると、参加者が増えるほど無駄が効く
  //   - **オフラインのとき** (`navigator.onLine`)。`online` イベントが復帰を拾う
  //
  // 不可視の間に溜まった変更は、**可視に戻った瞬間に取りに行く** — 次の tick を
  // 待つと最大で間隔ぶん古い画面を見せることになる。
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (stopped) return;
      // 画面を見ていて回線があるときだけ取りに行く。条件を満たさなくても
      // **タイマーは回し続ける** — 復帰したときに次の tick が拾う
      if (!document.hidden && navigator.onLine) await syncNow();
      if (stopped) return;
      timer = setTimeout(tick, pollIntervalMs);
    };
    void tick(); // 契機 1: ファイルを開いたとき

    const onOnline = () => void syncNow(); // 契機 2: 再接続
    const onVisible = () => {
      if (!document.hidden) void syncNow();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [syncNow, pollIntervalMs]);

  // content 経路は sheetId を渡す (W3c2)。structure 経路は省略 → file-level batch。
  const record = useCallback(
    (event: GraphEvent, sheetId?: SheetId) => tap?.record(event, sheetId),
    [tap],
  );

  return { record, clock, settled, syncNow };
}
