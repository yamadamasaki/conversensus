/**
 * 参加者の PDS の firehose に繋ぎ、「この File に新しい書き込みがあった」という合図を配る (#252)
 *
 * ## 合図だけを配る
 *
 * 流れは**合図**としてだけ使い、中身は今の受信の経路 (listRecords と検査) で取る (利用者判断
 * 2026-10-11)。正しさの経路は 1 本のままで、合図が抜けても壊れない — 間隔を延ばしたポーリングが
 * 拾う (`FileSession`)。合図は collection と rkey (の中の fileId) だけで絞り、DID では絞らない。
 * 参加者でない人の書き込みで合図が来ても、受信の検査が取り込まないので、名簿をここに持ち込まない。
 *
 * ## 細いネットワークで無駄に受けない
 *
 * PDS の firehose には、その PDS の全員の書き込みが record の中身ごと流れる (絞り込みはこちらでしか
 * できない)。**タブが背後にあるとき・オフラインのときは切る**。繋ぎ直しは間隔を延ばしながら試す。
 *
 * ## 繋ぐ先は PDS ごと
 *
 * 連合では、開いている File の参加者がいる PDS それぞれに繋ぐ。今は参加者の PDS を DID から
 * 解決しておらず (全員が自前の PDS 1 つにいる)、渡すのは 1 つである。
 */

import type { FileId } from '@conversensus/shared';
import { parseBatchRkey } from '../atproto/batchRkey';
import { decodeFirehoseFrame, firehoseUrlOf } from '../atproto/firehose';
import { NSID } from '../atproto/types';

/** 合図を出す collection。グラフの op-log と判断ログ (名簿) は、どちらも File の受信を要る */
const HINTED_COLLECTIONS: ReadonlySet<string> = new Set([
  NSID.batch,
  NSID.judgment,
]);

/** 繋ぎ直しの間隔の最初と上限。切れるたびに倍にし、繋がったら最初に戻す */
export const RECONNECT_MIN_MS = 1_000;
export const RECONNECT_MAX_MS = 60_000;

/**
 * 合図。`fileId` はその File に書き込みがあった。**`null` は「取りこぼしたかもしれない」** —
 * 繋がった・切れたときに出す。繋がるまでの間の書き込みは流れに載らないので、受けた側は 1 度取りに行く
 */
export type LiveHint = { fileId: FileId | null };

/** 受信の側 (`FileSession`) が見る口 */
export interface LiveSignal {
  /** どれかの PDS に繋がっているか。繋がっている間はポーリングの間隔を延ばす */
  isConnected(): boolean;
  onHint(listener: (hint: LiveHint) => void): () => void;
}

/** 接続の知らせ。エラーは閉じたことと同じに扱う (WebSocket はエラーの後に必ず閉じる) */
export type SocketHandlers = {
  onOpen: () => void;
  onMessage: (data: ArrayBuffer) => void;
  onClose: () => void;
};

/** 使う WebSocket の口だけ。テストで差し替える */
export type SocketLike = { close(): void };

export type LiveChannelDeps = {
  /** 繋ぐ PDS の URL (http/https) */
  pdsUrls: readonly string[];
  createSocket: (url: string, handlers: SocketHandlers) => SocketLike;
  /** 繋いでよいか (画面を見ていて、回線がある) */
  isActive: () => boolean;
  /** `isActive` の答えが変わりうるときに呼ばれる口を張る。外す関数を返す */
  watchActivity: (onChange: () => void) => () => void;
  /** 繋ぎ直しの間隔の最初と上限 (テストが縮める)。既定 `RECONNECT_MIN_MS` / `RECONNECT_MAX_MS` */
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
};

/** PDS 1 つぶんの接続 */
type Link = {
  url: string;
  socket: SocketLike | null;
  open: boolean;
  backoffMs: number;
  retry: ReturnType<typeof setTimeout> | undefined;
};

export class LiveChannel implements LiveSignal {
  private readonly deps: LiveChannelDeps;
  private readonly links: Link[];
  private readonly listeners = new Set<(hint: LiveHint) => void>();
  private stopped = true;

  constructor(deps: LiveChannelDeps) {
    this.deps = deps;
    this.links = deps.pdsUrls.map((pdsUrl) => ({
      url: firehoseUrlOf(pdsUrl),
      socket: null,
      open: false,
      backoffMs: this.minBackoff(),
      retry: undefined,
    }));
  }

  private minBackoff(): number {
    return this.deps.reconnectMinMs ?? RECONNECT_MIN_MS;
  }

  isConnected(): boolean {
    return this.links.some((link) => link.open);
  }

  onHint(listener: (hint: LiveHint) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 繋ぎ始める。止める関数を返す */
  start(): () => void {
    this.stopped = false;
    const unwatch = this.deps.watchActivity(() => this.follow());
    this.follow();
    return () => {
      this.stopped = true;
      unwatch();
      for (const link of this.links) this.disconnect(link);
    };
  }

  /** 繋いでよいかに合わせて、繋ぐか切る */
  private follow(): void {
    const active = !this.stopped && this.deps.isActive();
    for (const link of this.links) {
      if (active && link.socket === null && link.retry === undefined)
        this.connect(link);
      if (!active) this.disconnect(link);
    }
  }

  private connect(link: Link): void {
    const socket = this.deps.createSocket(link.url, {
      onOpen: () => {
        link.open = true;
        link.backoffMs = this.minBackoff();
        this.emit({ fileId: null });
      },
      onMessage: (data) => this.receive(data),
      onClose: () => {
        if (link.socket !== socket) return; // 自分で切った後の知らせ
        const wasOpen = link.open;
        link.socket = null;
        link.open = false;
        // 繋がっていた間の間隔の延長をやめるため、受信の側に知らせる
        if (wasOpen) this.emit({ fileId: null });
        this.scheduleRetry(link);
      },
    });
    link.socket = socket;
  }

  private scheduleRetry(link: Link): void {
    if (this.stopped || !this.deps.isActive()) return;
    link.retry = setTimeout(() => {
      link.retry = undefined;
      this.follow();
    }, link.backoffMs);
    link.backoffMs = Math.min(
      link.backoffMs * 2,
      this.deps.reconnectMaxMs ?? RECONNECT_MAX_MS,
    );
  }

  private disconnect(link: Link): void {
    clearTimeout(link.retry);
    link.retry = undefined;
    const { socket, open } = link;
    link.socket = null;
    link.open = false;
    socket?.close();
    if (open) this.emit({ fileId: null });
  }

  private receive(data: ArrayBuffer): void {
    const commit = decodeFirehoseFrame(new Uint8Array(data));
    if (commit === null) return;
    const files = new Set<FileId>();
    for (const { collection, rkey } of commit.paths) {
      if (!HINTED_COLLECTIONS.has(collection)) continue;
      const parsed = parseBatchRkey(rkey);
      if (parsed) files.add(parsed.fileId);
    }
    for (const fileId of files) this.emit({ fileId });
  }

  private emit(hint: LiveHint): void {
    for (const listener of this.listeners) listener(hint);
  }
}

/** ブラウザの口で作る。画面を見ていて回線があるときだけ繋ぐ */
export function browserLiveChannel(pdsUrls: readonly string[]): LiveChannel {
  return new LiveChannel({
    pdsUrls,
    createSocket: (url, { onOpen, onMessage, onClose }) => {
      const socket = new WebSocket(url);
      socket.binaryType = 'arraybuffer';
      socket.onopen = onOpen;
      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) onMessage(event.data);
      };
      socket.onclose = onClose;
      return socket;
    },
    isActive: () => !document.hidden && navigator.onLine,
    watchActivity: (onChange) => {
      document.addEventListener('visibilitychange', onChange);
      window.addEventListener('online', onChange);
      window.addEventListener('offline', onChange);
      return () => {
        document.removeEventListener('visibilitychange', onChange);
        window.removeEventListener('online', onChange);
        window.removeEventListener('offline', onChange);
      };
    },
  });
}
