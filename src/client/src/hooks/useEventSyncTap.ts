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
  ForkMeta,
  Lamport,
  Participation,
  SheetId,
} from '@conversensus/shared';
import { CausalClock } from '@conversensus/shared';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { fetchBatches, pushReceivedBatches } from '../api';
import type { RemoteSyncQueue } from '../atproto/remoteSyncQueue';
import { SYNC_POLL_INTERVAL_MS } from '../config';
import type { GraphEvent } from '../events/GraphEvent';
import type { DetectedConflicts } from '../sync/conflicts';
import {
  FileSession,
  providerFor,
  type ReceivedSummary,
  type TapHandle,
} from '../sync/fileSession';
import type { FileSessionPool } from '../sync/fileSessionPool';
import type { DetectedOverwrites } from '../sync/overwrites';
import type { RosterSource } from '../sync/rosterSource';
import type { SyncProvider } from '../sync/syncProvider';
import type { ForkWriterDeps } from '../sync/writeForks';

export type { ReceivedSummary, TapHandle } from '../sync/fileSession';

export type UseEventSyncTapOptions = {
  /**
   * セッションの置き場 (step3 Phase 3 S3-3c)。渡すと**セッションを自分で作らず置き場から借りる** —
   * 背後のタブが同じ File を持っていれば、同じセッションと発番器を使う。作り方 (remote キュー・
   * 名簿など) は置き場が持つので、下の設定の項目は使われない (知らせだけが効く)。
   * `holder` は置き場の持ち手の名前 (`FileSessionPool.hold`)。
   *
   * **知らせを持つのは 1 つの File につき 1 つのフックだけにする。**セッションの知らせは
   * 1 組で、描画のたびに差し替える。同じ File を 2 つのフックが借りると後から描いた方が勝つ。
   * 背後のタブは知らせを持たないので、フックを通さず置き場に直接宣言する
   */
  pool?: { pool: FileSessionPool<FileSession>; holder: string };
  /** remote 送信キュー。null/未指定なら local-only (未ログイン時と同じ挙動) */
  remoteQueue?: RemoteSyncQueue | null;
  /**
   * この op-log の発番下限 (branch のみ: 分岐点 `base.at`)。
   * 空の branch op-log でも base より後から発番させる (`EventSyncTap.clockFloor`)。
   */
  clockFloor?: Lamport;
  /**
   * 因果の発番器 (step3 Phase 1)。**branch の tap には trunk の tap のものを渡す** —
   * trunk とその branch・判断ログは同じ因果の範囲にあり、別々に振ると同じ点を 2 回使う
   * (`CausalClock` の冒頭)。省略すると (trunk の tap) File ごとに作る
   */
  causal?: CausalClock;
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
  /**
   * この op-log が branch のものであるときの trunk (step2 Phase 3 T7-3)。
   *
   * 渡すと受信が 2 点で変わる:
   *
   * - **名簿は trunk のものを読む。**branch は名簿を持たない。誰がいつ参加していたかは
   *   trunk の判断ログが決め、branch の編集もその期間で絞る
   * - **参加者の受信は「集めて追記する」だけにする。**implicit merge の競合検出・fork・
   *   上書きの報告は trunk の受信のものである。branch で走らせると fork が branch の
   *   op-log に書かれる。branch と trunk の対立は explicit merge が検出する
   *
   * 名簿の通知 (`onRoster`) も呼ばない — 共有状態の表示は trunk の tap が担う。
   */
  trunkFileId?: FileId;
  /** テスト用: ローカル正典 provider の差し替え (既定 `LocalServerSyncProvider`) */
  createLocalProvider?: (fileId: FileId) => SyncProvider;
  /**
   * テスト用: 受信の書き込み口の差し替え (既定 `pushReceivedBatches`)。
   * **安定参照であること** — 毎レンダー再生成すると受信 effect が張り直される。
   */
  appendReceived?: (fileId: FileId, batches: Batch[]) => Promise<number>;
  /**
   * 受信**前**のローカル正典を読む (step2 Phase 3 T5)。implicit merge の競合検出が
   * 「新しく届いた分」と「分岐点のグラフ」を求めるのに使う。
   * **安定参照であること** (`appendReceived` と同じ理由)。
   */
  fetchLocal?: (fileId: FileId) => Promise<Batch[]>;
  /**
   * fork の器 (step2 Phase 3 T6)。競合を保留した記録を branch として書く。
   * **安定参照であること** (`appendReceived` と同じ理由)。
   *
   * 省略すると **この tap の `record` で trunk の op-log に書き、`fetchLocal` の畳み込みから
   * 読む** (T7-1)。fork は受信した File の trunk にぶら下がるので、宛先はこの tap である。
   */
  forkDeps?: ForkWriterDeps;
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
  /**
   * 名簿を読んだときの通知 (step2 Phase 2)。**共有状態の表示に使う**。
   *
   * 同期サイクルは毎回名簿を読むので、これを渡すと「いま何人と共有しているか」
   * 「自分はまだ参加者か」が追加のリクエスト無しで分かる。
   * **安定参照であること** (`onReceived` と同じ理由)。
   */
  onRoster?: (fileId: FileId, participation: Participation) => void;
  /**
   * implicit merge で競合を検出したときの通知 (step2 Phase 3 T5)。
   *
   * **競合が 0 件のときは呼ばない。**同期サイクルは定期的に走るので、毎回呼ぶと
   * 人が読んでいる通知を空で上書きしてしまう。
   * **安定参照であること** (`onReceived` と同じ理由)。
   */
  onConflicts?: (
    fileId: FileId,
    detected: DetectedConflicts,
    /** 保留の記録 (fork) として書かれた件数 (Phase 3 T6) */
    forkCount: number,
  ) => void;
  /**
   * 自分の書いたものが新着に上書きされたときの通知 (step2 Phase 3 T8)。
   *
   * **0 件のときは呼ばない** — `onConflicts` と同じ理由である。ただし受け手は
   * これを**溜める** (自動では出さない印なので、上書きして消すと人が見る前に消える)。
   * **安定参照であること**。
   */
  onOverwrites?: (fileId: FileId, detected: DetectedOverwrites) => void;
  /**
   * 相手が書いた fork が届いたときの通知 (step2 Phase 3 T7-5)。
   *
   * **0 件のときは呼ばない** (`onConflicts` と同じ理由)。受け手は溜める — 競合の通知は
   * 検出のたびに置き換わるので、同じ入れ物だと次の検出で消える。
   * **安定参照であること**。
   */
  onForksArrived?: (fileId: FileId, forks: ForkMeta[]) => void;
  /**
   * 受信のサイクルが**最後まで走った**ことの合図 (step2 Phase 2 S6)。
   *
   * **`onReceived` では代わりにならない** — あれは着地した batch があるときだけ
   * 呼ばれるので、「取りこぼしが 1 件も無かった」ときに鳴らない。同期義務の解除に
   * 使うと、追いつくものが無い File で**永久に読み取り専用のまま**になる。
   *
   * 失敗したサイクルでは呼ばない。同期していないのに義務を解いてはならない。
   *
   * **安定参照であること** (`onReceived` と同じ理由)。
   */
  onSynced?: (
    fileId: FileId,
    tap: { settled: () => Promise<void>; pending: () => number },
  ) => void;
  /**
   * **同じブラウザの別のタブ**がこの File のローカル正典に書いた (step3 Phase 2 D3)。
   *
   * タブはそれぞれ Worker を持ち同じ DB に書くので、別のタブの書き込みは DB に入っても
   * この画面は知らない。知らせ (`local/localChanges.ts`) を受けたら、因果の知識に取り込んで
   * から (下の effect) これを呼ぶ。画面の差し替えは呼ぶ側が決める。
   *
   * **安定参照であること** (`onReceived` と同じ理由)。
   */
  onLocalChanged?: (fileId: FileId, tap: TapHandle) => void;
};

export type UseEventSyncTapResult = {
  /** dispatch された event を op-log へ流す (content 経路は sheetId 付き) */
  record: (event: GraphEvent, sheetId?: SheetId) => void;
  /**
   * この tap の因果の発番器。branch の tap・判断ログの書き込み・merge の写しへ渡して共有する
   * (File を開いていなければ null)
   */
  causal: CausalClock | null;
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
    pool: pooled,
    remoteQueue = null,
    actor,
    roster = null,
    trunkFileId,
    pollIntervalMs = SYNC_POLL_INTERVAL_MS,
    clockFloor,
    causal: causalOverride,
    createLocalProvider,
    appendReceived = pushReceivedBatches,
    fetchLocal = fetchBatches,
    forkDeps,
    onReceived,
    onRoster,
    onConflicts,
    onOverwrites,
    onForksArrived,
    onSynced,
    onLocalChanged,
  }: UseEventSyncTapOptions,
): UseEventSyncTapResult {
  // remote キューがあるときだけ fanout で包む。ローカル正典への経路は両者で同一。
  // (createLocalProvider を渡す場合は安定参照であること — 毎レンダー再生成すると tap が作り直される)
  // 置き場から借りるときは自分では作らない (`ownFileId` が null になる)
  const ownFileId = pooled ? null : fileId;
  const provider = useMemo(
    () =>
      ownFileId
        ? providerFor(ownFileId, remoteQueue, createLocalProvider)
        : null,
    [ownFileId, remoteQueue, createLocalProvider],
  );

  // 因果の発番器は File と actor ごと。渡されたら (branch の tap) それを使う。
  // **セッションより長く生きる** — ログインで remote キューが付いてセッションが
  // 作り直されても、発番器は同じものを使い続ける
  const ownCausal = useMemo(
    () => (ownFileId ? new CausalClock(actor) : null),
    [ownFileId, actor],
  );
  const causal = causalOverride ?? ownCausal;

  // fileId / provider が変われば新しいセッション (outbox を分離)。未オープン時は null
  const ownSession = useMemo(
    () =>
      ownFileId && provider && causal
        ? new FileSession({
            fileId: ownFileId,
            provider,
            causal,
            actor,
            remoteQueue,
            roster,
            trunkFileId,
            clockFloor,
            appendReceived,
            fetchLocal,
            forkDeps,
            pollIntervalMs,
          })
        : null,
    [
      ownFileId,
      provider,
      causal,
      actor,
      remoteQueue,
      roster,
      trunkFileId,
      clockFloor,
      appendReceived,
      fetchLocal,
      forkDeps,
      pollIntervalMs,
    ],
  );

  // 置き場から借りる。**描画の中で持つ** — 持つのは宣言なので何度しても同じで、ここで
  // 持てばこの描画のうちにセッションが手に入る (effect まで待つと最初の書き込みを落とす)
  if (pooled) pooled.pool.hold(pooled.holder, fileId ? [fileId] : []);
  const session = pooled
    ? fileId
      ? (pooled.pool.session(fileId) ?? null)
      : null
    : ownSession;

  // 知らせは毎レンダー最新に差し替える。セッション (とタイマー) は作り直さない
  const listeners = {
    onReceived,
    onRoster,
    onConflicts,
    onOverwrites,
    onForksArrived,
    onSynced,
    onLocalChanged,
  };
  session?.setListeners(listeners);
  const listenersRef = useRef(listeners);
  listenersRef.current = listeners;

  // 離すのは effect の後始末で。**借りていたセッションの知らせを外す** — 背後のタブが
  // 持ち続けるセッションが、前に出ている view の知らせ (共有状態・同期義務の更新) を呼ばないように。
  // 持ち直したら知らせも付け直す (StrictMode は後始末の直後に持ち直し、描画は挟まない)
  useEffect(() => {
    if (!pooled || !fileId) return;
    const { pool, holder } = pooled;
    pool.hold(holder, [fileId]);
    pool.session(fileId)?.setListeners(listenersRef.current);
    return () => {
      pool.session(fileId)?.setListeners({});
      pool.release(holder);
    };
  }, [pooled, fileId]);

  // 契機を張る (開いたとき・定期・再接続・可視化・別のタブの書き込み)。借りたセッションの
  // 契機は置き場が張る
  useEffect(() => ownSession?.start(), [ownSession]);

  // settled は セッションの作り直しをまたいで同じ参照でいてほしい
  const sessionRef = useRef(session);
  sessionRef.current = session;
  // セッションが無い (未オープン) ときは待つものが無いので即 resolve
  const settled = useCallback(
    () => sessionRef.current?.settled() ?? Promise.resolve(),
    [],
  );

  const syncNow = useCallback(
    () => session?.syncNow() ?? Promise.resolve(),
    [session],
  );

  // content 経路は sheetId を渡す (W3c2)。structure 経路は省略 → file-level batch。
  const record = useCallback(
    (event: GraphEvent, sheetId?: SheetId) => session?.record(event, sheetId),
    [session],
  );

  return {
    record,
    causal: pooled && fileId ? pooled.pool.causalOf(fileId) : causal,
    settled,
    syncNow,
  };
}
