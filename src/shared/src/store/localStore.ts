/**
 * ローカル正典の操作 (step3 Phase 2 D2)
 *
 * ローカルサーバの HTTP 経路が持っていたロジック — File の作成・取り込み・一覧・受信の追記・
 * blob の検査 — を、HTTP から切り離して 1 か所に集めたもの。`EventStore` (SQL) の 1 段上にある。
 *
 * 使い手は 2 つある (どちらもこれを薄く包むだけで、ロジックを持たない):
 *
 * - ブラウザ: Worker の中で client の `storeBackend` が包む
 * - App 結合テスト: 同じ `storeBackend` を同じプロセスで呼ぶ
 *
 * (step3 Phase 2 S2-7 まではローカルサーバの HTTP 経路も使い手だった)
 *
 * **ロジックが 1 つであることが要点である。**テストがプロセス内で通したものと、ブラウザで
 * 動くものが同じになる。
 */

import { computeBlobCid, MAX_BLOB_SIZE } from '../blob';
import { graphFileToBatches } from '../events/genesis';
import { METAGRAPH_SHEET_KIND, SHEET_KIND_PROPERTY } from '../events/sheetKind';
import type { Actor, Batch } from '../events/unified';
import { parseConversensusFile } from '../migrations';
import type {
  EdgeId,
  FileId,
  GraphFile,
  GraphFileListItem,
  NodeId,
  SheetId,
} from '../schemas';
import type { EventStore, LocalActorBatchCount } from './eventStore';

const DEFAULT_FILE_NAME = '無題';
const DEFAULT_SHEET_NAME = 'Sheet 1';
/** File 作成時に作る metagraph の名前 (仕様: デフォルトで "index"。変更可能) */
const DEFAULT_METAGRAPH_NAME = 'index';
/** blob ストアが受け付ける MIME の接頭辞。今のところ画像だけ (ANA-116) */
const IMAGE_MIME_PREFIX = 'image/';

/** File の作成要求 (`CreateFileRequestSchema` の形) */
export type CreateFileRequest = {
  name?: string;
  description?: string;
  sheet?: { name?: string };
};

/** 格納した blob */
export type StoredBlob = { cid: string; mimeType: string; size: number };

/** blob を受け付けなかった理由。HTTP では状態コードに、ブラウザでは例外の文言になる */
export type BlobRejection =
  | { reason: 'unsupportedType'; message: string }
  | { reason: 'empty'; message: string }
  | { reason: 'tooLarge'; message: string };

export type ImportResult =
  | { ok: true; file: GraphFile }
  | { ok: false; error: unknown };

const newId = () => crypto.randomUUID();

export class LocalStore {
  readonly events: EventStore;

  constructor(events: EventStore) {
    this.events = events;
  }

  /** 一覧 (削除済み・0 シートを除く) */
  listFiles(): GraphFileListItem[] {
    return this.events.listOplogFiles();
  }

  /** op-log を持つ file_id の全集合 (削除済みも含む。remote からの発見の既知集合, ANA-127) */
  listAllFileIds(): FileId[] {
    return this.events.listAllFileIds();
  }

  /** 未ログインの actor の batch の件数 (File と actor ごと, FPR 前 L-1) */
  listLocalActorBatches(): LocalActorBatchCount[] {
    return this.events.listLocalActorBatches();
  }

  /** actor を付け替える (FPR 前 L-1)。@returns 付け替えた batch の数 */
  renameActor(from: Actor, to: Actor): number {
    return this.events.renameActor(from, to);
  }

  /** 新しい File を作り、genesis の op-log を書く (step1 Phase 6 p6-1) */
  createFile(request: CreateFileRequest): GraphFile {
    const file: GraphFile = {
      id: newId() as FileId,
      name: request.name ?? DEFAULT_FILE_NAME,
      description: request.description,
      sheets: [
        {
          id: newId() as SheetId,
          name: request.sheet?.name ?? DEFAULT_SHEET_NAME,
          nodes: [],
          edges: [],
        },
        // 目次の metagraph (step3 Phase 4, 仕様: File を作るとその中の sheet の一つとして metagraph が
        // 作られる)。graph node は op として積まず、sheet の一覧から導出する (D2)
        {
          id: newId() as SheetId,
          name: DEFAULT_METAGRAPH_NAME,
          nodes: [],
          edges: [],
          properties: { [SHEET_KIND_PROPERTY]: METAGRAPH_SHEET_KIND },
        },
      ],
    };
    this.initializeOplog(file);
    return file;
  }

  /**
   * `.conversensus` を取り込み、新しい File として op-log を書く。
   *
   * **id はすべて振り直す** (sheet / node / edge / layout と、その参照)。同じファイルを
   * 2 回取り込んでも別の File になる。同梱の blob (`blobs`) はここで落とす —
   * op-log へ base64 を持ち込まない (ANA-116)。実体は client が先にローカルへ戻している
   */
  importFile(raw: unknown): ImportResult {
    // 旧版の解釈は shared に 1 本化してある (ANA-116 D1)
    const parsed = parseConversensusFile(raw);
    if (!parsed.success) return { ok: false, error: parsed.error };
    const { version: _, blobs: _blobs, ...fileData } = parsed.data;
    const file: GraphFile = {
      ...fileData,
      id: newId() as FileId,
      sheets: fileData.sheets.map((sheet) => {
        const nodeIdMap = new Map<string, NodeId>(
          sheet.nodes.map((n) => [n.id, newId() as NodeId]),
        );
        const edgeIdMap = new Map<string, EdgeId>(
          sheet.edges.map((e) => [e.id, newId() as EdgeId]),
        );
        const nodeOf = (id: string) => (nodeIdMap.get(id) ?? id) as NodeId;
        const edgeOf = (id: string) => (edgeIdMap.get(id) ?? id) as EdgeId;
        return {
          ...sheet,
          id: newId() as SheetId,
          nodes: sheet.nodes.map((n) => ({
            ...n,
            id: nodeOf(n.id),
            ...(n.parentId ? { parentId: nodeOf(n.parentId) } : {}),
          })),
          edges: sheet.edges.map((e) => ({
            ...e,
            id: edgeOf(e.id),
            source: nodeOf(e.source),
            target: nodeOf(e.target),
          })),
          layouts: sheet.layouts?.map((l) => ({
            ...l,
            nodeId: nodeOf(l.nodeId),
          })),
          edgeLayouts: sheet.edgeLayouts?.map((l) => ({
            ...l,
            edgeId: edgeOf(l.edgeId),
          })),
        };
      }),
    };
    // id を振り直した後の `file` をそのまま genesis にするので、返す GraphFile と
    // op-log の projection は同じ内容になる
    this.initializeOplog(file);
    return { ok: true, file };
  }

  /** 自分の編集を追記する (べき等)。@returns 新規に追記した件数 */
  appendBatches(fileId: FileId, batches: Batch[]): number {
    return this.events.appendBatches(fileId, batches);
  }

  /**
   * remote から受信した batch を追記する (べき等)。
   *
   * 中身は自分の編集の追記と同じである。step1 Phase 4d-5 以来、受信は「正典の marker」を同じ tx で
   * 立てていたが、それは旧 snapshot の移行 (ローカルサーバ) から受信内容を守るためで、
   * サーバを撤去した step3 Phase 2 S2-7 で役目を終えた。**口は分けたまま残す** — 受信と
   * 自分の編集は、知らせ (`broadcastingBackend`) などで扱いを変えうる
   */
  appendReceived(fileId: FileId, batches: Batch[]): number {
    return this.events.appendBatches(fileId, batches);
  }

  /** op-log を読む。`since` を渡すと clock がそれより後のものだけ */
  getBatches(fileId: FileId, since?: number): Batch[] {
    const batches = this.events.getBatches(fileId);
    return since === undefined
      ? batches
      : batches.filter((b) => b.clock > since);
  }

  /**
   * 画像を格納する (ANA-116)。**cid はここで内容から計算する** — 呼び出し側の申告を鍵に
   * 使うと、内容と一致しない cid でストアを汚せる。同じ内容は 1 行で、返る cid も同じ
   *
   * 受け付けるのは画像だけ、空でなく、PDS の上限 (`MAX_BLOB_SIZE`) 以下のもの。上限を
   * ここで断るのは、送信時に初めて失敗して outbox に詰まるより分かりやすいからである
   */
  async putBlob(
    bytes: Uint8Array,
    mimeType: string,
  ): Promise<{ ok: true; blob: StoredBlob } | ({ ok: false } & BlobRejection)> {
    if (!mimeType.startsWith(IMAGE_MIME_PREFIX)) {
      return {
        ok: false,
        reason: 'unsupportedType',
        message: `Unsupported Content-Type: ${mimeType}`,
      };
    }
    if (bytes.byteLength === 0) {
      return { ok: false, reason: 'empty', message: 'Empty body' };
    }
    if (bytes.byteLength > MAX_BLOB_SIZE) {
      return {
        ok: false,
        reason: 'tooLarge',
        message: `Blob too large (max ${MAX_BLOB_SIZE} bytes)`,
      };
    }
    const cid = await computeBlobCid(bytes);
    this.events.putBlob(cid, bytes, mimeType);
    return { ok: true, blob: { cid, mimeType, size: bytes.byteLength } };
  }

  /** blob の実体。無ければ null (他端末が作った画像では普通に起こる) */
  getBlob(cid: string) {
    return this.events.getBlob(cid);
  }

  /** genesis の op-log を書く (作った時点で op-log が正典, step1 Phase 6 p6-1) */
  private initializeOplog(file: GraphFile): void {
    this.events.appendBatches(file.id, graphFileToBatches(file));
  }
}
