/**
 * FileSession: File 1 つの書き込み・同期・受信を束ねる (step3 Phase 3 S3-0)
 *
 * 以前は `useEventSyncTap` の中身そのものだった。フックは 1 つのコンポーネントに 1 回しか
 * 呼べないので、**同時に開ける File は 1 つ**という前提が React の構造に埋まっていた。
 * タブと multiple モード (Phase 3) は複数の File を同時に開くので、React の外へ出した。
 * フックはこれを作って生かすだけの薄い包みになる。
 *
 * 持つもの:
 *
 * - **tap** (`EventSyncTap`): dispatch された event を op-log へ流す
 * - **同期のサイクル** (`syncNow`): 送信の catch-up と受信 (自分の repo → 名簿 → 参加者の repo)
 * - **同期の契機** (`start`): 開いたとき・定期・再接続・可視に戻ったとき、別のタブの書き込み
 *
 * 発番器 (`CausalClock`) は**外から受け取る**。trunk とその branch・判断ログで共有するもので、
 * セッションの作り直し (ログインで remote キューが付くなど) をまたいで生きる必要があるため。
 */

import type {
  Actor,
  Batch,
  CausalClock,
  FileId,
  ForkMeta,
  Lamport,
  Participation,
  SheetId,
} from '@conversensus/shared';
import { didFromActor } from '@conversensus/shared';
import { FanoutSyncProvider } from '../atproto/fanoutSyncProvider';
import type { RemoteSyncQueue } from '../atproto/remoteSyncQueue';
import type { GraphEvent } from '../events/GraphEvent';
import { subscribeLocalChanges } from '../local/localChanges';
import { branchMetaRecorder, readBranchMeta } from './branchMetaLog';
import type { DetectedConflicts } from './conflicts';
import { EventSyncTap } from './eventSyncTap';
import type { DetectedOverwrites } from './overwrites';
import {
  collectParticipantBatches,
  receiveParticipantBatches,
} from './receiveParticipantBatches';
import { receiveRemoteBatches } from './receiveRemoteBatches';
import type { RosterSource } from './rosterSource';
import type { SyncProvider } from './syncProvider';
import type { ForkWriterDeps } from './writeForks';

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

/**
 * セッションから外への知らせ。**作り直さずに差し替えられる** (`setListeners`)。
 * 各知らせの意味は `UseEventSyncTapOptions` の同名の項目を参照
 */
export type FileSessionListeners = {
  onReceived?: (
    fileId: FileId,
    result: ReceivedSummary,
    tap: TapHandle,
  ) => void;
  onRoster?: (fileId: FileId, participation: Participation) => void;
  onConflicts?: (
    fileId: FileId,
    detected: DetectedConflicts,
    forkCount: number,
  ) => void;
  onOverwrites?: (fileId: FileId, detected: DetectedOverwrites) => void;
  onForksArrived?: (fileId: FileId, forks: ForkMeta[]) => void;
  onSynced?: (fileId: FileId, tap: TapHandle) => void;
  onLocalChanged?: (fileId: FileId, tap: TapHandle) => void;
};

export type FileSessionDeps = {
  fileId: FileId;
  /** ローカル正典 (ログイン中は remote への fanout 込み) */
  provider: SyncProvider;
  /** 因果の発番器。trunk とその branch・判断ログで共有する (冒頭の注) */
  causal: CausalClock;
  actor: Actor;
  remoteQueue: RemoteSyncQueue | null;
  roster: RosterSource | null;
  /** この op-log が branch のものであるときの trunk (T7-3) */
  trunkFileId?: FileId;
  /** この op-log の発番下限 (branch のみ: 分岐点 `base.at`) */
  clockFloor?: Lamport;
  appendReceived: (fileId: FileId, batches: Batch[]) => Promise<number>;
  fetchLocal: (fileId: FileId) => Promise<Batch[]>;
  /** fork の器。省略するとこのセッションの tap で trunk の op-log に書く (T7-1) */
  forkDeps?: ForkWriterDeps;
  /** 定期同期の間隔 (ミリ秒) */
  pollIntervalMs: number;
};

export class FileSession {
  readonly fileId: FileId;
  readonly causal: CausalClock;
  private readonly deps: FileSessionDeps;
  private readonly tap: EventSyncTap;
  private readonly forkDeps: ForkWriterDeps;
  private listeners: FileSessionListeners = {};
  private runningSync: Promise<void> | null = null;

  constructor(deps: FileSessionDeps) {
    this.deps = deps;
    this.fileId = deps.fileId;
    this.causal = deps.causal;
    this.tap = new EventSyncTap({
      provider: deps.provider,
      actor: deps.actor,
      clockFloor: deps.clockFloor,
      causal: deps.causal,
      onError: (error) => console.warn('[sync] batch flush failed:', error),
    });
    // fork の器 (T7-1)。既定はこのセッションの tap から組み立てる — セッションが
    // 作り直されたら器も作り直される (古い tap の outbox へ書かない)
    this.forkDeps = deps.forkDeps ?? {
      readBranches: async (trunkFileId) => [
        ...(
          await readBranchMeta(deps.fetchLocal, trunkFileId)
        ).branches.values(),
      ],
      recordBranchCreated: branchMetaRecorder((event) => this.tap.record(event))
        .branchCreated,
      newId: () => crypto.randomUUID(),
    };
  }

  /** 知らせの差し替え。セッションを作り直さない (タイマーも張り直さない) */
  setListeners(listeners: FileSessionListeners): void {
    this.listeners = listeners;
  }

  /** dispatch された event を op-log へ流す (content 経路は sheetId 付き, W3c2) */
  record(event: GraphEvent, sheetId?: SheetId): void {
    this.tap.record(event, sheetId);
  }

  /** これまでに record した event の drain 完了を待つ (§p5-4) */
  settled(): Promise<void> {
    return this.tap.settled();
  }

  private handle(): TapHandle {
    return {
      settled: () => this.tap.settled(),
      pending: () => this.tap.pending,
    };
  }

  /**
   * remote と突き合わせて差分を埋める (送信の catch-up + 受信)。
   *
   * **契機は 4 つある** (§3.4 + ANA-202 + step2 Phase 2 S4):
   *
   * 1. ファイルを開いたとき (`start`)
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
  syncNow(): Promise<void> {
    const { provider, remoteQueue } = this.deps;
    if (!(provider instanceof FanoutSyncProvider) || !remoteQueue) {
      return Promise.resolve();
    }
    // 走っているサイクルに相乗りする (S4)。契機が 4 つあるので重なりは常態である
    if (this.runningSync) return this.runningSync;

    const { fileId } = this;
    const cycle = Promise.all([
      provider
        .catchUpRemote()
        .catch((error) =>
          console.warn('[sync] remote catch-up failed:', error),
        ),
      this.receiveAll(remoteQueue)
        .then((result) => {
          if (result.appended > 0) {
            console.info(
              `[sync] received ${result.received} remote batch(es), ` +
                `${result.appended} new`,
            );
            // 画面反映の起点 (Phase 4e-3)。着地していない受信 (appended=0) では
            // 呼ばない — 再 projection しても画面は変わらない。
            this.listeners.onReceived?.(fileId, result, this.handle());
          }
          // **義務の解除はここである** (S6)。着地の有無によらず、受信が最後まで
          // 走ったことだけを伝える。
          //
          // **画面が古いままかの確認もここに乗る** (#202)。`onReceived` は
          // 「このブラウザが追記したとき」しか鳴らないので、**同じ正典を共有する
          // 別の窓**が書いた分では鳴らない (もう正典に入っているので追記が 0 になる)。
          // 古いのはローカル正典ではなく画面の方である
          this.listeners.onSynced?.(fileId, this.handle());
        })
        .catch((error) => console.warn('[sync] remote receive failed:', error)),
    ])
      .then(() => undefined)
      // **自分が最新のときだけ外す。**失敗したサイクルを残すと、以後の呼び出しが
      // 同じ失敗を受け取り続ける (`rosterSource` と同じ判断)
      .finally(() => {
        if (this.runningSync === cycle) this.runningSync = null;
      });
    this.runningSync = cycle;
    return cycle;
  }

  /**
   * 受信の 2 本の脚 (step2 Phase 2 S2)。
   *
   * **順序が意味を持つ。**自分の repo は名簿によらず読めるので先に読む。参加者の repo は
   * 「読む順序は名簿 → グラフに固定される」ので、名簿を読んでからでないと読めない。
   *
   * 名簿が読めなくても自分の分は取り込み済である — 相手の PDS が応答しないことは
   * 正常に起こるので、そこで自分の別端末の編集まで止めない。
   */
  private async receiveAll(
    remoteQueue: RemoteSyncQueue,
  ): Promise<ReceivedSummary> {
    const { fileId, tap } = this;
    const { roster, trunkFileId, actor, appendReceived, fetchLocal } =
      this.deps;
    // 受信は fanout を通さない (echo ループ回避, §3.3a)。ローカル正典への直書き。
    const own = await receiveRemoteBatches(fileId, {
      // 取得はファイル単位 (Phase 7 p7-2)。repo 全体を落として捨てる形を止めた
      pullRemoteForFile: (id) => remoteQueue.pullRemoteForFile(id),
      appendReceived,
      observeRemote: (batches) => tap.observeRemote(batches),
    });
    if (!roster) return own;

    // branch は名簿を持たないので trunk の名簿を読む (T7-3)
    const seen = await roster.read(trunkFileId ?? fileId);

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
    tap.observeRemote(seen.batches);

    const participation = seen.participation;
    // 共有状態の表示元 (2026-09-05)。読んだ名簿をそのまま渡す —
    // 表示のために名簿をもう一度読むと、参加者分のリクエストが倍になる。
    // branch のセッションは通知しない (T7-3) — 共有状態は trunk の File のものである。
    if (!trunkFileId) this.listeners.onRoster?.(fileId, participation);

    // **自分が参加者でなければ他 actor の repo を読まない** (2026-09-05 実機で発覚)。
    //
    // 期間フィルタは「書いた人がその時参加していたか」を見るので、**読む側が
    // 離脱していても相手の編集は通ってしまう**。取り消されたのに相手の編集が
    // 届き続けるのは, 取り消しを共有を切る操作として使えないということである。
    //
    // 仕様のワークフロー 6-3 (再参加する前に標準 projection へ同期しなければ
    // ならない) が成り立つのも, **離脱中は受け取っていない**からである。
    // 受け取り続けるなら同期義務は要らない。
    //
    // ローカル正典はそのまま残る (自分の写しである)。止まるのは取り込みだけで、
    // 「共有が切れている」ことは画面に出す責務が別にある。
    if (!participation.participating.has(didFromActor(actor))) {
      console.info(
        `[sync] ${fileId}: この File の参加者ではないので他 actor の repo を読まない`,
      );
      return own;
    }

    // branch の受信は集めて追記するだけ (T7-3)。implicit merge の検出と fork は
    // trunk の受信のものなので走らせない (`UseEventSyncTapOptions.trunkFileId` を参照)
    if (trunkFileId) {
      const collected = await collectParticipantBatches(
        fileId,
        participation,
        didFromActor(actor),
        {
          pullRemoteForFile: (id, repo) =>
            remoteQueue.pullRemoteForFile(id, repo),
        },
      );
      const appended =
        collected.batches.length > 0
          ? await appendReceived(fileId, collected.batches)
          : 0;
      // 受信規則。書き込みが成功してから前進させる (`receiveParticipantBatches` と同じ)
      tap.observeRemote(collected.batches);
      return {
        received: own.received + collected.batches.length,
        appended: own.appended + appended,
      };
    }

    const others = await receiveParticipantBatches(
      fileId,
      participation,
      didFromActor(actor),
      {
        pullRemoteForFile: (id, repo) =>
          remoteQueue.pullRemoteForFile(id, repo),
        fetchLocal,
        ...this.forkDeps,
        appendReceived,
        observeRemote: (batches) => tap.observeRemote(batches),
      },
    );
    // **0 件では呼ばない。**サイクルは定期的に走るので、空で上書きすると
    // 人が読んでいる通知が消える
    if (others.conflicts.conflicts.length > 0) {
      this.listeners.onConflicts?.(
        fileId,
        others.conflicts,
        others.forks.length,
      );
    }
    // 上書きの報告は競合と**別系列**である (Phase 3 T8)。同じ受信で両方 0 件でない
    // ことはあるが、同じ組が両方に出ることはない (並行か、見た上でかで排他に振り分ける)
    if (others.overwrites.reports.length > 0) {
      this.listeners.onOverwrites?.(fileId, others.overwrites);
    }
    // 相手が保留した競合の到着 (T7-5)。自分が書いた fork は `onConflicts` が伝えている
    if (others.arrivedForks.length > 0) {
      this.listeners.onForksArrived?.(fileId, others.arrivedForks);
    }
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
  }

  /**
   * 同期の契機を張る (§3.4 + step2 Phase 2 S4)。返す関数で外す。
   *
   * **定期ポーリングは「前回の完了から N ミリ秒」で回す。**`setInterval` にすると
   * 遅い PDS で要求が積み上がる (前のサイクルが終わる前に次が始まる)。
   *
   * 止める条件を 2 つ持つ。どちらも「見ていない画面のために相手の PDS を叩かない」
   * ためである。
   *
   *   - **ブラウザのタブが不可視のとき** (`document.hidden`)。裏で開いたままのタブが 30 秒ごとに
   *     参加者全員の repo を読み続けると、参加者が増えるほど無駄が効く
   *   - **オフラインのとき** (`navigator.onLine`)。`online` イベントが復帰を拾う
   *
   * 不可視の間に溜まった変更は、**可視に戻った瞬間に取りに行く** — 次の tick を
   * 待つと最大で間隔ぶん古い画面を見せることになる。
   *
   * **別のタブの書き込みも受ける** (step3 Phase 2 D3)。画面より先に**因果の知識**に入れる —
   * 入れないと、別のタブの編集を見た上で書いた batch の deps にそれが載らず、並行と判定されて
   * 偽の競合になる (step3 Phase 1 D4)。`restore` は何度呼んでもよい (各値の最大を取るだけ)
   */
  start(): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (stopped) return;
      // 画面を見ていて回線があるときだけ取りに行く。条件を満たさなくても
      // **タイマーは回し続ける** — 復帰したときに次の tick が拾う
      if (!document.hidden && navigator.onLine) await this.syncNow();
      if (stopped) return;
      timer = setTimeout(tick, this.deps.pollIntervalMs);
    };
    void tick(); // 契機 1: ファイルを開いたとき

    const onOnline = () => void this.syncNow(); // 契機 2: 再接続
    const onVisible = () => {
      if (!document.hidden) void this.syncNow();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);

    const { fileId } = this;
    const unsubscribeLocal = subscribeLocalChanges((change) => {
      if (change.fileId !== fileId) return;
      this.deps
        .fetchLocal(fileId)
        .then((batches) => {
          this.causal.restore(batches);
          this.listeners.onLocalChanged?.(fileId, this.handle());
        })
        .catch((error) =>
          console.warn('[sync] 別のタブの書き込みを読めなかった:', error),
        );
    });

    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      unsubscribeLocal();
    };
  }
}
