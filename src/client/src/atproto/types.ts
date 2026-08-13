/**
 * PDS 上のレコードの型 (ATProto)
 *
 * **今 PDS へ書くのは batch レコードだけである。** かつてここには step0 の
 * 「エンティティ 1 件 = レコード 1 件」設計のレコード型が並んでいたが
 * (`FileRecord` / `SheetRecord` / `NodeRecord` / `EdgeRecord` / `NodeLayoutRecord` /
 * `EdgeLayoutRecord` / `BranchRecord` / `CommitRecord` / `MergeRecord`, および
 * `NodeRecord` からしか参照されていなかった `ImageBlobRef` と `StrongRef`),
 * step1 の op-log 正典化で**全部死んだ**ので削除した (ANA-116 レビュー §9 N1)。
 *
 * `ImageBlobRef` が 3 箇所に増えていた原因でもある — **生きているのは
 * `images/imageBlob.ts` のもの**である。
 *
 * **型を消しても PDS 上の既存レコードは消えない。** 対応する lexicon
 * (`lexicons/app/conversensus/graph/*.json`) と NSID 定数は残してある。
 */

import type { AtUri, Batch, FileId, ISODateString } from '@conversensus/shared';

/**
 * Lexicon NSID 定数
 *
 * **今 PDS へ書くのは `batch` だけである** (`file` は step0 の legacy レコードを
 * 消すためだけに残っている — `collections.ts` の `files.delete`)。
 * 残りの NSID は `lexicons/app/conversensus/graph/*.json` と対になっており,
 * **既存の repo に残っているレコードの名前**なので消していない。
 */
export const NSID = {
  file: 'app.conversensus.graph.file',
  sheet: 'app.conversensus.graph.sheet',
  node: 'app.conversensus.graph.node',
  edge: 'app.conversensus.graph.edge',
  nodeLayout: 'app.conversensus.graph.nodeLayout',
  edgeLayout: 'app.conversensus.graph.edgeLayout',
  branch: 'app.conversensus.graph.branch',
  commit: 'app.conversensus.graph.commit',
  merge: 'app.conversensus.graph.merge',
  /** 操作ログ (統一語彙の Batch) を PDS 上の op-log レコードとして持つ (step1 Phase 4c) */
  batch: 'app.conversensus.graph.batch',
} as const;

export type RecordResult = { uri: AtUri; cid: string };

/**
 * 統一語彙 Batch の PDS 表現 (step1 Phase 4c, op-log コレクション)。
 * rkey = batchId。id は rkey として持つのでボディには含めない。
 * clock/timestamp/ops を非可逆なしで保持し、正典モデル (操作ログ) と同形にする。
 */
export type BatchRecord = {
  $type: typeof NSID.batch;
  /**
   * この batch が属するファイル (Phase 4d-1, 必須)。
   *
   * ローカル正典では op-log が既にファイル単位に仕切られている (`batches.file_id` 列) ので
   * fileId は文脈から復元できるが、**ATProto の batch コレクションは repo 全体で 1 つ**なので
   * レコード自身が持たないと受信側が適用先を復元できない。特に file 構造 batch は
   * `sheetId` すら持たないため手掛かりが皆無になる (設計 `step1-phase4d-receive.md` §3.1)。
   */
  fileId: string;
  actor: string;
  clock: number;
  timestamp: number;
  ops: unknown[]; // Op[] を JSON として格納 (records は任意 JSON を許容)
  /**
   * content batch の発生元シート (統一語彙 Batch.sheetId と対等)。
   * file 構造 batch (sheet./file. 系の op) は sheetId を持たないため optional。
   * 旧データ (sheetId 無しレコード) との後方互換のためにも optional (W3d5-1)。
   */
  sheetId?: string;
  createdAt: ISODateString;
};

/**
 * remote 経路の運搬単位 (Phase 4d-1)。
 *
 * 統一語彙の `Batch` に `fileId` を**外から添えた**エンベロープ。`Batch` 自身には
 * `fileId` を持たせない — ローカルでは op-log がファイル単位に仕切られており
 * (`batches.file_id` 列)、埋め込むと列と二重持ちになって食い違う余地が生まれるため。
 * 「ローカルでは文脈、remote では埋め込み」という非対称を、この境界の型で表現する。
 *
 * (対比: `sheetId` は 1 ファイルに複数シートがあり文脈から復元できないので `Batch` に載る)
 */
export type RemoteBatch = {
  fileId: FileId;
  batch: Batch;
};

/**
 * remote に存在するファイル 1 件分の列挙結果 (ANA-127 S3)。
 *
 * 発見経路 (`discoverRemoteFiles`) が列挙に求めるのは fileId の集合だけだったが、
 * **削除済みファイルを materialize し直さない**ためには「remote 側で削除されているか」も
 * 要る。列挙は各ファイルの最大 clock のレコードに着地する (`listBatchFileHeads`) ので、
 * 削除が最大 clock の tombstone として置かれている限り、**本体を引かずに**判定できる。
 *
 * `deleted` は「着地レコードが tombstone だった」という意味であって、
 * 「op-log のどこにも `file.remove` が無い」ことの証明ではない (tombstone より後に
 * 別端末の batch が載れば着地点は動く)。取りこぼしは pull 後の `isFileDeleted` が拾う
 * — 二段構えである理由がこれである (設計 §4 D1 の層 2)。
 */
export type RemoteFileEntry = {
  fileId: FileId;
  deleted: boolean;
};
