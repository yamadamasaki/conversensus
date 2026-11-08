/**
 * headless の client (agent 段 2)
 *
 * ブラウザの外 (bun のプロセス) で、1 つの DID として conversensus の File を同期する。
 * 設計: `deepse/architecture/step4/agent-actor.md` D3、計画: `deepse/plans/agent-stage2-headless.md`。
 *
 * **新しいロジックは持たない。**client の部品 (正典・remote キュー・名簿・発番器・`FileSession`・
 * 判断の書き込み) を組み立てるだけである。ブラウザでは同じ組み立てが hooks
 * (`useFileSheetOperations`・`useRosterSource`・`useRemoteSyncQueue`・`useParticipation`) に
 * 散っている。組み立てを 2 つ持つことになるが、部品が同じなので同期の振る舞いは同じになる。
 *
 * **1 プロセス = 1 agent** (計画 F8)。client の正典と認証の口 (`setLocalBackend`・`setAuthBackend`) と
 * `localStorage` はプロセスに 1 つなので、同時に開けるのは 1 つだけである。
 *
 * `dataDir` に置くもの:
 *
 * | file | 中身 |
 * | --- | --- |
 * | `store.sqlite` | ローカル正典 (op-log と blob)。ブラウザの OPFS 上の SQLite と同じ schema |
 * | `storage.json` | `localStorage` の代わり (端末の id・セッション・参加の初期化の印) |
 */

import { join } from 'node:path';
import { setLocalBackend } from '@conversensus/client/src/api';
import { AtprotoSyncProvider } from '@conversensus/client/src/atproto/atprotoSyncProvider';
import type { AuthBackend } from '@conversensus/client/src/atproto/auth';
import {
  login,
  logout,
  resumeSession,
  setAuthBackend,
} from '@conversensus/client/src/atproto/client';
import { batches } from '@conversensus/client/src/atproto/collections';
import { handleLabels } from '@conversensus/client/src/atproto/identity';
import {
  listJudgmentFileIds,
  loadRoster,
  putJudgment,
} from '@conversensus/client/src/atproto/judgmentStore';
import { RemoteSyncQueue } from '@conversensus/client/src/atproto/remoteSyncQueue';
import type { GraphEvent } from '@conversensus/client/src/events/GraphEvent';
import { createPdsBlobUploader } from '@conversensus/client/src/images/imageBlob';
import type { LocalBackend } from '@conversensus/client/src/local/backend';
import { storeBackend } from '@conversensus/client/src/local/storeBackend';
import { getDeviceId } from '@conversensus/client/src/sync/actor';
import { appendJudgment } from '@conversensus/client/src/sync/appendJudgment';
import { discoverParticipatingFiles } from '@conversensus/client/src/sync/discoverParticipatingFiles';
import { discoverRemoteFiles } from '@conversensus/client/src/sync/discoverRemoteFiles';
import { ensureOwnGenesis } from '@conversensus/client/src/sync/ensureOwnGenesis';
import {
  FileSession,
  providerFor,
} from '@conversensus/client/src/sync/fileSession';
import {
  recallOwnJudgmentPoint,
  rememberOwnJudgmentPoint,
} from '@conversensus/client/src/sync/ownJudgmentPoint';
import {
  decodeParticipationCode,
  encodeParticipationCode,
} from '@conversensus/client/src/sync/participationCode';
import { collectParticipantBatches } from '@conversensus/client/src/sync/receiveParticipantBatches';
import { senderOf } from '@conversensus/client/src/sync/requestArrival';
import {
  createRosterSource,
  type RosterSource,
} from '@conversensus/client/src/sync/rosterSource';
import {
  type Actor,
  type BatchId,
  CausalClock,
  type Did,
  EventStore,
  type FileId,
  type GraphFile,
  type GraphFileListItem,
  isAddressedTo,
  type JudgmentBatch,
  type JudgmentOp,
  LocalStore,
  METAGRAPH_SHEET_KIND,
  projectFile,
  type RequestEntry,
  requestsInFile,
  resolveTemplates,
  type SheetId,
  sheetKindOf,
} from '@conversensus/shared';
import { BunSqliteDriver } from '@conversensus/shared/src/store/bunSqliteDriver';
import { lockDataDir } from './dataDirLock';
import { encodeFile } from './encoding';
import { FileStorage } from './fileStorage';
import { type ToolContext, ToolError } from './tools';

/** `dataDir` の中の file の名前 */
const STORE_FILE = 'store.sqlite';
const STORAGE_FILE = 'storage.json';

export type HeadlessOptions = {
  /** ローカル正典と `localStorage` の代わりを置く directory (無ければ作らない。呼ぶ側が用意する) */
  dataDir: string;
  /** 認証の口。本番は OAuth (H4)、テストは偽の PDS へのパスワード */
  auth: AuthBackend;
};

/**
 * ログインしている間だけ存在するもの。DID が変われば別の repo への送信・別の名簿になるので、
 * まとめて作り直す (`useRemoteSyncQueue`・`useRosterSource` と同じ単位)
 */
type Connection = {
  did: Did;
  actor: Actor;
  remoteQueue: RemoteSyncQueue;
  roster: RosterSource;
};

/** 発見 (`discover`) の結果 */
export type DiscoverResult = {
  /** 自分の repo から見つけた File (別の端末で作ったもの) */
  own: FileId[];
  /** 参加を承認した、他の actor の File */
  participating: FileId[];
};

/** 定期の契機は使わない (段 2 は `sync` が呼ばれたときだけ同期する。常駐は段 5) */
const NO_POLLING_MS = Number.POSITIVE_INFINITY;

/** 開いている headless。プロセスに 1 つ */
let opened: Headless | null = null;

export class Headless {
  readonly store: LocalStore;
  readonly backend: LocalBackend;
  /** 入れる前の `localStorage` の定義。閉じるときに戻す */
  private readonly previousStorage: PropertyDescriptor | undefined;
  private connection: Connection | null = null;
  private readonly clocks = new Map<FileId, CausalClock>();
  private readonly sessions = new Map<FileId, FileSession>();
  /** 置き場所の lock を放す */
  private readonly unlock: () => void;

  private constructor(options: HeadlessOptions) {
    // **何より先に取る。**別のプロセスが同じ置き場所を握っていれば、何も触らずに断る
    this.unlock = lockDataDir(options.dataDir);
    this.previousStorage = Object.getOwnPropertyDescriptor(
      globalThis,
      'localStorage',
    );
    // **client の部品より先に入れる。**`safeStorage` は使うたびに `globalThis.localStorage` を読むので、
    // 呼ばれる前であればよい。代入ではなく定義する — DOM のある環境 (テストの happy-dom) では
    // 読み取り専用の getter だからである
    Object.defineProperty(globalThis, 'localStorage', {
      value: new FileStorage(join(options.dataDir, STORAGE_FILE)),
      configurable: true,
      writable: true,
    });
    this.store = new LocalStore(
      new EventStore(new BunSqliteDriver(join(options.dataDir, STORE_FILE))),
    );
    this.backend = storeBackend(this.store);
    setLocalBackend(this.backend);
    setAuthBackend(options.auth);
  }

  /** 開く。前のセッションが `dataDir` に残っていれば戻す (戻せなければ未ログイン) */
  static async open(options: HeadlessOptions): Promise<Headless> {
    if (opened) {
      throw new Error('[headless] 既に開いている (1 プロセス = 1 agent)');
    }
    const headless = new Headless(options);
    opened = headless;
    const session = await resumeSession();
    if (session) headless.connect(session.did);
    return headless;
  }

  /** ログインする。OAuth では `auth` の実装がブラウザでの同意を待つ (H4) */
  async signIn(handle: string, password?: string): Promise<Did> {
    const session = await login(handle, password);
    this.connect(session.did);
    return session.did;
  }

  /** ログインしている DID。していなければ例外 */
  get did(): Did {
    return this.requireConnection().did;
  }

  /** この端末の actor (`did#deviceId`)。端末の id は `dataDir` に残るので、起動をまたいで同じ */
  get actor(): Actor {
    return this.requireConnection().actor;
  }

  /**
   * File の発番器。**File ごとに 1 つ**で、セッションより長く生きる (`FileSessionPool` と同じ理由)。
   * この端末が前に書いた判断の点を下限に入れる (#261 の窓 1)
   */
  clockOf(fileId: FileId): CausalClock {
    let clock = this.clocks.get(fileId);
    if (!clock) {
      clock = new CausalClock(this.actor);
      const own = recallOwnJudgmentPoint(fileId, this.actor);
      if (own) clock.restore([{ ...own, deps: {} }]);
      this.clocks.set(fileId, clock);
    }
    return clock;
  }

  /** 手元の File の一覧 (削除済み・0 シートを除く) */
  files(): Promise<GraphFileListItem[]> {
    return this.backend.fetchFiles();
  }

  /** File を作る (genesis まで書く)。PDS へは次の `sync` で送る */
  async createFile(name: string): Promise<FileId> {
    const file = await this.backend.createFile(name);
    return file.id as FileId;
  }

  /**
   * File の trunk を読む (手元の正典の op-log を畳んだもの)。最新にしたければ先に `sync` を呼ぶ
   */
  read(fileId: FileId): GraphFile {
    return projectFile(this.store.events.getBatches(fileId), fileId);
  }

  /**
   * File の trunk を、agent に読ませる完全な encoding で出す (設計 D4)。sheet に当たっている
   * template を引いて、種別の名前と説明を注釈に添える
   */
  encode(fileId: FileId): string {
    const trunk = this.store.events.getBatches(fileId);
    return encodeFile(projectFile(trunk, fileId), (sheet) =>
      resolveTemplates(sheet.templateIds, trunk, fileId),
    );
  }

  /**
   * File の参加者 (DID とハンドル名)。依頼の宛先を選ぶのに使う (agent 段 4 R6)
   */
  async participants(fileId: FileId): Promise<{ did: Did; handle: string }[]> {
    const { roster } = this.requireConnection();
    const { participation } = await roster.read(fileId);
    const dids = [...participation.participating];
    const labelOf = await handleLabels.resolve(dids);
    return dids.map((did) => ({ did, handle: labelOf(did) }));
  }

  /**
   * 自分宛ての未回答の依頼 (agent 段 4 R6)。**自分が送ったものは除く** — 宛先が不特定なら自分も
   * 宛先に入るが、自分の依頼に自分で答えることはない。手元の正典から読む (最新にするなら先に `sync`)
   */
  requestsForMe(fileId: FileId): (RequestEntry & { from: Did | undefined })[] {
    const { did } = this.requireConnection();
    const batches = this.store.events.getBatches(fileId);
    return requestsInFile(projectFile(batches, fileId)).flatMap((r) => {
      const from = senderOf(batches, r.node.id);
      return r.status === 'sent' && isAddressedTo(r.node, did) && from !== did
        ? [{ ...r, from }]
        : [];
    });
  }

  /**
   * 書く道具 (`tools.ts`) が見るもの: trunk の今の Sheet と、そこに当たっている template。
   * `record` したものが正典に入ってから読むこと (`settled`)
   *
   * metagraph (`index`) には書かせない。画面は metagraph の編集を別の op に読み替えて
   * (`metagraphTransform`) いて、道具はその読み替えを持たないからである
   */
  toolContext(fileId: FileId, sheetId: string): ToolContext {
    const trunk = this.store.events.getBatches(fileId);
    const sheet = projectFile(trunk, fileId).sheets.find(
      (s) => s.id === sheetId,
    );
    if (!sheet) throw new ToolError(`この File に Sheet ${sheetId} は無い`);
    if (sheetKindOf(sheet) === METAGRAPH_SHEET_KIND) {
      throw new ToolError(
        'metagraph (index) の Sheet には書けない。読むだけにする',
      );
    }
    return {
      sheet,
      templates: resolveTemplates(sheet.templateIds, trunk, fileId),
    };
  }

  /**
   * File に書く。**UI と同じ GraphEvent の経路**を通す (`EventSyncTap` が op に落とす)。op を直に組む
   * 口は作らない — 書く経路を 2 つにすると、手元の状態と op-log の projection が食い違いうる
   * (計画 §5)。`sheetId` は書く先の Sheet (UI の「開いている Sheet」に当たる)。
   *
   * 正典への書き込みは非同期に進む。読む前・送る前に `settled` を待つ
   */
  record(fileId: FileId, sheetId: SheetId, event: GraphEvent): void {
    this.sessionOf(fileId).record(event, sheetId);
  }

  /** `record` した書き込みが正典に入るのを待つ */
  async settled(fileId: FileId): Promise<void> {
    await this.sessionOf(fileId).settled();
  }

  /**
   * File の同期を 1 回する: 送信の catch-up と受信 (自分の repo → 名簿 → 参加者の repo)。
   * 名簿の起点が無ければ置く (`ensureOwnGenesis`)。中身は `FileSession.syncNow` である
   */
  async sync(fileId: FileId): Promise<void> {
    const session = this.sessionOf(fileId);
    // 書いたものが正典に入ってから同期する。入る前に送信の catch-up が走ると、次の同期まで残る
    await session.settled();
    await session.syncNow();
  }

  /**
   * 手元に無い File を見つけて立ち上げる。**列挙の入口は自分の repo だけ** (U6-P1):
   *
   * 1. 自分の repo のグラフの op-log (同じ DID の別の端末で作った File)
   * 2. 自分の repo の判断ログ (参加を承認した File)。名簿で「いま参加者か」を確かめてから読む
   *
   * App では 1 の後に 2 を走らせる (`useFileSheetOperations`)。順も同じにする
   */
  async discover(): Promise<DiscoverResult> {
    const { did, remoteQueue, roster } = this.requireConnection();
    const own = await discoverRemoteFiles({
      listRemoteFiles: () => remoteQueue.listRemoteFiles(),
      pullRemoteForFile: (fileId) => remoteQueue.pullRemoteForFile(fileId),
      listLocalFileIds: this.backend.fetchLocalFileIds,
      appendReceived: this.backend.pushReceivedBatches,
    });
    const participating = await discoverParticipatingFiles({
      listJudgmentFileIds: () => listJudgmentFileIds(),
      listLocalFileIds: this.backend.fetchLocalFileIds,
      readRoster: (fileId) => roster.read(fileId),
      collectFromParticipants: (fileId, participation) =>
        collectParticipantBatches(fileId, participation, did, {
          pullRemoteForFile: (id, repo) =>
            remoteQueue.pullRemoteForFile(id, repo),
        }),
      appendReceived: this.backend.pushReceivedBatches,
      viewer: did,
    });
    return { own: own.discovered, participating: participating.discovered };
  }

  /**
   * File に参加を依頼する。**DID で依頼する** — ハンドル名の解決は呼ぶ側の仕事である。
   * @returns 相手に渡す参加コード
   */
  async invite(fileId: FileId, target: Did): Promise<string> {
    const { did } = this.requireConnection();
    // 書く前に名簿を genesis まで読む。直前に読んだ判断ログを発番の seed に渡さないと、
    // 判断ログの方が進んでいるときに同じ点を振る (`useParticipation` の `write` と同じ理由)
    const seen = await loadRoster({ fileId, seed: did, passes: 'converge' });
    await this.judge(
      fileId,
      [{ kind: 'participation.invite', target }],
      seen.batches,
    );
    return encodeParticipationCode({ fileId, inviter: did, invitee: target });
  }

  /**
   * 参加コードで参加を承認し、その File を手元に立ち上げる。
   *
   * **書く前に依頼の実在を確かめる** (`useParticipation` の `previewCode` と同じ)。依頼が無ければ
   * 承認は名簿の畳み込みで捨てられる — 捨てられると分かっているものを書かない
   */
  async accept(code: string): Promise<FileId> {
    const { did } = this.requireConnection();
    const decoded = decodeParticipationCode(code);
    if (!decoded.ok) {
      throw new Error(`[headless] 参加コードを読めない: ${decoded.reason}`);
    }
    const { inviter, invitee } = decoded.payload;
    const fileId = decoded.payload.fileId as FileId;
    if (invitee !== did) {
      throw new Error(`[headless] このコードは ${invitee} 宛てである`);
    }
    // 起点は自分ではなく依頼者。自分はまだ名簿に載っていない。genesis に届くまで広げる
    const seen = await loadRoster({
      fileId,
      seed: inviter,
      passes: 'converge',
    });
    if (seen.participation.invited.get(did) !== inviter) {
      throw new Error('[headless] 依頼が見つからない');
    }
    await this.judge(
      fileId,
      [{ kind: 'participation.accept', inviter }],
      seen.batches,
    );
    await this.discover();
    return fileId;
  }

  /**
   * 閉じる。**ログアウトはしない** — セッションは `dataDir` に残り、次に開いたときに戻る。
   * 入れた大域 (正典・認証の口・`localStorage`) を元に戻し、DB を閉じる
   */
  async close(): Promise<void> {
    if (opened !== this) return;
    setLocalBackend(null);
    setAuthBackend(null);
    if (this.previousStorage) {
      Object.defineProperty(globalThis, 'localStorage', this.previousStorage);
    } else {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    }
    this.store.events.close();
    this.unlock();
    opened = null;
  }

  /** ログアウトして閉じる。セッションの記録も `dataDir` から消える */
  async signOutAndClose(): Promise<void> {
    await logout();
    await this.close();
  }

  /** ログインした DID の部品を作る */
  private connect(did: Did): void {
    const actor = `${did}#${getDeviceId()}` as Actor;
    const fetchBatches = this.backend.fetchBatches;
    this.connection = {
      did,
      actor,
      remoteQueue: new RemoteSyncQueue({
        provider: new AtprotoSyncProvider({
          batches,
          uploadBlobs: createPdsBlobUploader(),
        }),
        // 送るのは自分が書いた batch だけ (受信した他の actor の batch を送り返さない)
        did,
        // 「この端末だけの File」(#253) は headless では作らない
        isLocalOnly: () => false,
      }),
      roster: createRosterSource({
        loadRoster,
        ensureOwnGenesis: (fileId: FileId, known: readonly JudgmentBatch[]) =>
          ensureOwnGenesis({ fetchBatches, putJudgment, actor }, fileId, known),
        viewer: did,
      }),
    };
    // 発番器とセッションは actor に紐づくので、前の接続のものは使わない
    this.clocks.clear();
    this.sessions.clear();
  }

  private requireConnection(): Connection {
    if (!this.connection) throw new Error('[headless] ログインしていない');
    return this.connection;
  }

  /** File のセッション。File ごとに 1 つ (同期が 2 本走ると outbox が割れる) */
  private sessionOf(fileId: FileId): FileSession {
    let session = this.sessions.get(fileId);
    if (!session) {
      const { actor, remoteQueue, roster } = this.requireConnection();
      session = new FileSession({
        fileId,
        // ローカル正典 + remote へ fanout する
        provider: providerFor(fileId, remoteQueue),
        causal: this.clockOf(fileId),
        actor,
        remoteQueue,
        roster,
        appendReceived: this.backend.pushReceivedBatches,
        fetchLocal: this.backend.fetchBatches,
        pollIntervalMs: NO_POLLING_MS,
      });
      this.sessions.set(fileId, session);
    }
    return session;
  }

  /** 判断を書く。発番器はその File のグラフと同じもの (`appendJudgment` の約束) */
  private async judge(
    fileId: FileId,
    ops: JudgmentOp[],
    known: readonly JudgmentBatch[],
  ): Promise<void> {
    const { actor } = this.requireConnection();
    await appendJudgment(
      {
        clockFor: async (id) => {
          const clock = this.clockOf(id);
          clock.restore(await this.backend.fetchBatches(id));
          return clock;
        },
        // 振った点を覚える。判断ログはローカル正典に載らないので、覚えないと
        // 再起動の後に同じ点を振る (#261 の窓 1)
        rememberPoint: rememberOwnJudgmentPoint,
        actor,
        putJudgment,
        newBatchId: () => crypto.randomUUID() as BatchId,
      },
      fileId,
      ops,
      known,
    );
  }
}
