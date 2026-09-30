/**
 * RemoteSyncQueue: remote (ATProto) への未送信を破棄せず保持する再送キュー (step1 W3d5-3)
 *
 * ローカル正典 (daemon op-log) 向けの `Outbox` とは**別建て**の、remote 専用キュー
 * (設計 §3.1 / §3.6)。remote が落ちても編集フロー (ローカル正典) は前進し、未送信は
 * このキューに残って UI に「クラウド未同期: N 件」として現れ、自動/手動再送で回復する。
 * 純 fire-and-forget (サイレント消失) を採らないための中核。
 *
 * - **enqueue**: remote leg のフィルタ (`filterBatchesForRemote`) を内部で適用してから積む。
 *   presentation 除外 (§3.2) と、**他 actor が書いた batch の除外** (step2 Phase 2 S0) の
 *   2 つを落とす。genesis は Phase 4e-0 の C1 見直しで remote へ通す (どちらの除外の対象でもない)。
 *   フィルタで空になれば積まない。
 * - **flush (best-effort)**: 内包 `Outbox` 経由で remote provider へ push。成功→除去、
 *   失敗→保持 (破棄しない)。失敗は編集フローに波及しない。
 * - **catch-up**: remote の**そのファイル分**を pull し、remote に無いローカル batch を
 *   積み直して flush する (取りこぼし回収)。起動時/再接続時の呼び出しは W3d5-5 で配線済。
 *   コストは catch-up 1 回 = そのファイルの履歴 1 回 (Phase 7 p7-2 で全件 pull から縮小)。
 * - **上限 (D1)**: 内包 `Outbox` に `REMOTE_QUEUE_MAX` を渡し無制限成長を防ぐ。溢れた分は
 *   ローカル正典に残るため catch-up で回収でき、データは失われない。
 * - **pending 公開**: 未送信件数を購読可能にし (§3.7 UI 用)、tap の pending に合流させる。
 */

import type { Batch, Did, FileId } from '@conversensus/shared';
import type { FlushResult } from '../sync/outbox';
import { Outbox } from '../sync/outbox';
import type { Unsubscribe } from '../sync/syncProvider';
import { filterBatchesForRemote } from './remoteFilter';
import type { RemoteBatch, RemoteFileEntry } from './types';

/**
 * remote op-log の送信先 (Phase 4d-1)。
 *
 * `SyncProvider` ではなく専用の型にする — `SyncProvider` はファイル単位の境界だが、
 * ATProto の batch コレクションは **repo 全体で 1 つ**なので、送信単位は fileId を
 * 添えた `RemoteBatch` になる。この非対称が型に現れるようにしている。
 */
export interface RemoteBatchTarget {
  /**
   * batch をまとめて remote へ書く (べき等)。
   *
   * **一部だけ送れたときは `PartialPushError` を投げる契約** (ANA-116 レビュー D2)。
   * 素の例外は「1 件も送れていない」= 全件保留を意味する。この区別が無いと、
   * 構造的に送れない 1 件が無関係な batch の送信を止め続ける。
   */
  pushRemote(entries: readonly RemoteBatch[]): Promise<void>;
  /**
   * remote の batch のうち **1 ファイル分**を取得する (Phase 7 p7-2)。
   *
   * `since` を取らないのは全件版と同じ理由 — 既読位置を持たない契約は変わらず、
   * 絞るのは「repo 全体 → 1 ファイル」の軸だけである (設計 §1.4 / §2.2)。
   */
  pullRemoteForFile(fileId: FileId, repo?: Did): Promise<RemoteBatch[]>;
  /**
   * remote に存在するファイルを列挙する (Phase 7 p7-3 / ANA-127 S3)。
   *
   * batch 本体を伴わない — 未知ファイルの発見は「まず fileId の集合を知り、
   * 未知の分だけ本体を取る」形になる (設計 §3.3)。列挙で読む 1 レコードから
   * 「remote 側で削除済みか」も分かるので、それを `RemoteFileEntry.deleted` に載せる。
   */
  listRemoteFiles(): Promise<RemoteFileEntry[]>;
}

/** remote キューのセッション内保持上限 (直近 N 件)。溢れは catch-up で回収 (D1) */
export const REMOTE_QUEUE_MAX = 500;

/** pending 件数の変化を受け取るリスナ */
export type PendingListener = (count: number) => void;

export type RemoteSyncQueueDeps = {
  /** remote op-log (AtprotoSyncProvider 等)。flush / catch-up の送信先・取得元 */
  provider: RemoteBatchTarget;
  /**
   * この端末がログインしている DID (step2 Phase 2 S0)。
   *
   * **送るのは自分が書いた batch だけ**という制約をここで持つ。Phase 2 で受信が他 actor の
   * batch をローカル正典へ入れるので、これが無いと `catchUp` が相手の op-log を自分の repo へ
   * 複製する (`remoteFilter.ts` の設計注)。**キューは repo (= session) 単位**なので、
   * DID もキューの寿命と一致する。
   */
  did: Did;
  /** 保持上限 (直近 N 件)。既定 REMOTE_QUEUE_MAX */
  capacity?: number;
};

export class RemoteSyncQueue {
  private readonly outbox: Outbox<RemoteBatch>;
  private readonly provider: RemoteBatchTarget;
  private readonly did: Did;
  private readonly listeners = new Set<PendingListener>();

  constructor(deps: RemoteSyncQueueDeps) {
    this.provider = deps.provider;
    this.did = deps.did;
    // 重複排除は (fileId, batch id) の組で行う (step2 Phase 3 T7-2)。
    //
    // step2 では merge の写しが branch の batch と**同じ id** を持ったので、id だけを鍵にすると
    // branch 分の保留が trunk 分を黙って捨てた。step3 Phase 1 D2 で写しは新しい id を持つように
    // なり、この衝突は起きなくなったが、「ローカル正典はファイル単位、remote の rkey も
    // `<fileId>~…` で fileId を含む」ので、鍵に fileId を含める形はそのまま揃えておく
    this.outbox = new Outbox<RemoteBatch>(
      (entry) => `${entry.fileId}~${entry.batch.id}`,
      deps.capacity ?? REMOTE_QUEUE_MAX,
    );
  }

  /**
   * remote へ送る batch を積む。presentation 除外と**他 actor の batch の除外** (S0) は
   * enqueue 内で適用するので、呼び出し側は生の batch 列を渡してよい。フィルタ後に何も
   * 残らなければ何もしない。
   *
   * **`catchUp` もこの口を通る**ので、受信した他 actor の batch が remote へ送り返される
   * ことはない (Phase 2 設計 事実 A)。
   */
  enqueue(batches: readonly Batch[], fileId: FileId): void {
    const filtered = filterBatchesForRemote(batches, this.did);
    if (filtered.length === 0) return;
    // fileId は remote レコードに埋め込む必要があるのでここで添える (§3.1)
    this.outbox.enqueue(filtered.map((batch) => ({ fileId, batch })));
    this.notify();
  }

  /**
   * 保留を remote provider へ best-effort に送る。成功→除去、失敗→保持 (破棄しない)。
   * 失敗は呼び出し側 (§3.7 の手動再送・catch-up) に FlushResult で通知される。
   */
  async flush(): Promise<FlushResult> {
    const result = await this.outbox.flush((entries) =>
      this.provider.pushRemote(entries),
    );
    this.notify();
    return result;
  }

  /**
   * 取りこぼし回収。remote の**そのファイル分**を pull し、remote に無いローカル batch を
   * 積み直して flush する。`localBatches` はローカル正典の全 batch (呼び出し側が渡す)。
   *
   * **⚠️ ローカル正典には他 actor の batch が入る** (step2 Phase 2 の受信)。積み直しは
   * `enqueue` を通るので、`filterBatchesForRemote` が著者で落とす — ここが無いと
   * 相手の op-log を自分の repo へ複製してしまう (S0 / Phase 2 設計 事実 A)。
   *
   * **Phase 7 p7-2 で取得をファイル単位に絞った**。以前は repo 全件 pull → fileId で
   * 絞り込みで、`localBatches` が 1 ファイル分なのに無関係な全件を毎回落としていた
   * (4d-4 で JS 側の絞り込みは入ったが、転送量は全件のままだった)。
   * コストは catch-up 1 回 = **そのファイルの履歴 1 回**になった。
   *
   * **fileId フィルタは防御として残す** (設計 §3.5)。取得の正しさは rkey 形式に依存するので、
   * 「他ファイルの batch を remote 済みと誤認して push を取りやめる」ことが rkey の
   * 崩れで起きないようにする。(誤マッチ自体は起きない — batch id は UUID なのでファイルを
   * 跨いで衝突しない。)
   */
  async catchUp(
    localBatches: readonly Batch[],
    fileId: FileId,
  ): Promise<FlushResult> {
    const remote = await this.provider.pullRemoteForFile(fileId);
    const remoteIds = new Set(
      remote.filter((e) => e.fileId === fileId).map((e) => e.batch.id),
    );
    const missing = localBatches.filter((b) => !remoteIds.has(b.id));
    this.enqueue(missing, fileId);
    return this.flush();
  }

  /**
   * remote の batch を**ファイル単位で**取得する (Phase 7 p7-2)。受信経路の既定。
   *
   * 全件版と同じく取得のみを委譲する。書き込みには使わない (echo ループ回避, §3.3a)。
   *
   * **`repo` を省くと自分の repo** (step2 Phase 2 S2)。多アクタ同期は参加者の DID を
   * 順に渡してその actor の op-log を読む。送信側 (`enqueue` / `flush`) に repo が
   * 無いのと対になっている — 読むのは N 人、書くのは自分だけである。
   */
  pullRemoteForFile(fileId: FileId, repo?: Did): Promise<RemoteBatch[]> {
    return this.provider.pullRemoteForFile(fileId, repo);
  }

  /**
   * remote に存在するファイルを列挙する (Phase 7 p7-3)。未知ファイル発見の入口。
   * 取得のみを委譲する (書き込みには使わない, §3.3a)。
   */
  listRemoteFiles(): Promise<RemoteFileEntry[]> {
    return this.provider.listRemoteFiles();
  }

  /** 現在の未送信件数 */
  get pendingCount(): number {
    return this.outbox.size;
  }

  /** 現在の未送信項目 (FIFO のコピー) */
  pending(): RemoteBatch[] {
    return this.outbox.pending();
  }

  /** 上限超過で eviction が起きたか (UI の「N 件以上」表示用, D1) */
  get overflowed(): boolean {
    return this.outbox.overflowed;
  }

  /**
   * pending 件数の変化を購読する (§3.7 UI 用)。登録直後に現在値を 1 回通知する。
   * 返り値で解除する。
   */
  subscribe(listener: PendingListener): Unsubscribe {
    this.listeners.add(listener);
    listener(this.pendingCount);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const count = this.pendingCount;
    for (const listener of this.listeners) listener(count);
  }
}
