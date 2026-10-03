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
 * **型を消しても PDS 上の既存レコードは消えない。**v1 の collection とその lexicon は
 * step3 Phase 1 で読むのをやめた (v2 の lexicon は `lexicons/app/conversensus/v2/`)。
 */

import type {
  AtUri,
  Batch,
  FileId,
  ISODateString,
  JudgmentBatch,
} from '@conversensus/shared';

/**
 * Lexicon NSID 定数 (v2, step3 Phase 1 D9)。
 *
 * v1 の collection (`app.conversensus.graph.*`) は読みも書きもしない。互換性を持たない
 * と決めた (設計 §0) ので、古い repo に残るレコードは新しい読み手から最初から見えない。
 */
export const NSID = {
  /**
   * 操作ログ (統一語彙の Batch)。**v2** (step3 Phase 1 D9): 点と依存を持つ形になったので
   * collection ごと新しくした。v1 (`app.conversensus.graph.batch`) は読まない
   */
  batch: 'app.conversensus.v2.batch',
  /**
   * 判断ログ (step2 Phase 1)。**batch と分ける理由は畳み込みの意味論が違うこと**で、
   * ここの op は pre 条件を検証して満たさないものを捨てるが、グラフの op は
   * LWW / add-wins で解決するので「無効な op」という概念がない。
   */
  judgment: 'app.conversensus.v2.judgment',
  /**
   * 閉じた通知 (step3 Phase 6)。通知の内容は op-log から導出するので、ここには
   * 「閉じた」ことだけを置く。1 件 1 record の足すだけの集合
   */
  noticeDismissal: 'app.conversensus.v2.noticeDismissal',
  /** Folder (step3 Phase 6)。actor 固有の state。1 Folder 1 record (rkey = FolderId) */
  folder: 'app.conversensus.v2.folder',
  /** File の置き場 (step3 Phase 6)。1 File 1 record (rkey = FileId) */
  filePlacement: 'app.conversensus.v2.filePlacement',
} as const;

export type RecordResult = { uri: AtUri; cid: string };

/**
 * 統一語彙 Batch の PDS 表現 (v2, step3 Phase 1)。
 * rkey は `<fileId>~<actor>~<seq>` で、**id は本文に持つ** (rkey に入らなくなったため)。
 * clock/seq/deps/timestamp/ops を非可逆なしで保持し、正典モデル (操作ログ) と同形にする。
 */
export type BatchRecord = {
  $type: typeof NSID.batch;
  id: string;
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
  /** 因果の点 (Batch.seq と対等) */
  seq: number;
  /** 因果の知識 (Batch.deps と対等) */
  deps: Record<string, number>;
  timestamp: number;
  ops: unknown[]; // Op[] を JSON として格納 (records は任意 JSON を許容)
  /** merge の写しなら元の batch の点 (統一語彙 Batch.copyOf と対等, step3 Phase 1 D2) */
  copyOf?: { actor: string; seq: number };
  /** どの merge コミットの写しか (統一語彙 Batch.mergedIn と対等, step2 Phase 3 T7-4) */
  mergedIn?: string;
  /**
   * content batch の発生元シート (統一語彙 Batch.sheetId と対等)。
   * file 構造 batch (sheet./file. 系の op) は sheetId を持たないため optional。
   */
  sheetId?: string;
  createdAt: ISODateString;
};

/**
 * 判断ログの PDS 表現 (step2 Phase 1)。
 *
 * `BatchRecord` と同じ形にしてある。**rkey も同じスキーム** (`<fileId>~<actor>~<seq>`) を使うが、
 * collection が違うので rkey 空間は衝突しない。同じにするのは、他 actor の repo から
 * 1 ファイル分の名簿だけを prefix 範囲取得するためである — 相手の repo は自分のより
 * 大きいのが普通なので、全部読む形にはできない (U6-P1 スパイク)。
 *
 * `sheetId` を持たない — 判断は File 単位であってシート単位ではない。
 */
export type JudgmentRecord = {
  $type: typeof NSID.judgment;
  id: string;
  /** この判断が属するファイル (UUID)。collection は repo 全体で 1 つなので必須 */
  fileId: string;
  actor: string;
  /** **グラフの op-log と同じ clock 空間である。**独立した採番を作ってはならない */
  clock: number;
  /** 因果の点。**グラフの op-log と同じ連番を共有する** */
  seq: number;
  deps: Record<string, number>;
  timestamp: number;
  ops: unknown[];
  createdAt: ISODateString;
};

/**
 * 閉じた通知の PDS 表現 (step3 Phase 6)。rkey は `<fileId>~<鍵の SHA-256>`
 * (`noticeDismissalRkey`)。鍵は rkey に使えない文字を含むので、本文に持つ
 */
export type NoticeDismissalRecord = {
  $type: typeof NSID.noticeDismissal;
  fileId: string;
  key: string;
  dismissedAt: ISODateString;
};

/** Folder の PDS 表現 (step3 Phase 6)。**id は rkey が持つ** (本文に二重に持たない) */
export type FolderRecord = {
  $type: typeof NSID.folder;
  name: string;
  parent?: string;
  createdAt: ISODateString;
};

/** File の置き場の PDS 表現 (step3 Phase 6)。**fileId は rkey が持つ** */
export type FilePlacementRecord = {
  $type: typeof NSID.filePlacement;
  folder: string;
};

/** 判断ログの運搬単位。`RemoteBatch` と同じ非対称 (ローカルは文脈・remote は埋め込み) */
export type RemoteJudgment = {
  fileId: FileId;
  batch: JudgmentBatch;
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
