/**
 * ローカル正典のバックエンドの口 (step3 Phase 2 D2)
 *
 * client がローカル正典 (op-log と blob の保存先) に頼むことの全部。step1 以来の `api.ts` の
 * 9 関数をそのまま形にしたもので、実装を差し替えられるようにする:
 *
 * - `workerBackend`: ブラウザ。Worker の中の `storeBackend` を RPC で呼ぶ
 * - `storeBackend`: `LocalStore` を同じスレッドで直接呼ぶ (Worker の中と、App 結合テスト)
 *
 * step3 Phase 2 S2-7 まではローカルサーバ (bun) を HTTP で叩く実装もあった。
 *
 * **関数の形は変えない。**hooks から上はこの口だけを見ているので、向こう側が HTTP でも
 * Worker でも動く (step3 実装計画の事実 1)。
 */

import type {
  Batch,
  BlobCid,
  ConversensusFile,
  FileId,
  GraphFile,
  GraphFileListItem,
  Lamport,
  MimeType,
  StoredBlob,
} from '@conversensus/shared';

export interface LocalBackend {
  /** 一覧 (削除済み・0 シートを除く) */
  fetchFiles(): Promise<GraphFileListItem[]>;
  /** op-log を持つ file_id の全集合 (削除済みも含む, ANA-127) */
  fetchLocalFileIds(): Promise<FileId[]>;
  /** 新しい File を作る (genesis の op-log まで書く) */
  createFile(name: string): Promise<GraphFile>;
  /** `.conversensus` を取り込む。**呼ぶのは `files/fileTransfer.ts` だけ** (同梱 blob の復元とセット) */
  postImportFile(data: Omit<ConversensusFile, 'blobs'>): Promise<GraphFile>;
  /** 自分の編集を追記する。@returns 新規に追記した件数 */
  pushBatches(fileId: FileId, batches: Batch[]): Promise<number>;
  /** **remote から受信した** batch を追記する (正典の marker を同じ tx で立てる) */
  pushReceivedBatches(fileId: FileId, batches: Batch[]): Promise<number>;
  /** op-log を読む。`since` を渡すと clock > since のみ */
  fetchBatches(fileId: FileId, since?: Lamport): Promise<Batch[]>;
  /** 画像を格納する (cid は内容から計算される)。断られたら理由つきで throw */
  putBlob(bytes: Uint8Array, mimeType: MimeType): Promise<StoredBlob>;
  /** blob の実体。**この端末に無ければ undefined** (他端末の画像では普通に起こる) */
  fetchBlob(cid: BlobCid): Promise<Blob | undefined>;
}
