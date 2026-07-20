import type {
  AtUri,
  Batch,
  Did,
  FileId,
  ISODateString,
  Rkey,
} from '@conversensus/shared';

// ATProto strongRef: uri (AT-URI) + cid (content hash)
export type StrongRef = { uri: AtUri; cid: string };

// Lexicon NSID 定数
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

export type FileRecord = {
  $type: typeof NSID.file;
  name: string;
  description?: string;
  createdAt: ISODateString;
};

export type SheetRecord = {
  $type: typeof NSID.sheet;
  name: string;
  description?: string;
  file?: StrongRef; // 親ファイルへの参照 (後方互換のため optional)
  createdAt: ISODateString;
};

export type ImageBlobRef = {
  $type: 'blob';
  ref: { $link: string };
  mimeType: string;
  size: number;
};

export type NodeRecord = {
  $type: typeof NSID.node;
  sheet: StrongRef;
  content: string;
  properties?: unknown;
  nodeType?: 'group' | 'image';
  parent?: StrongRef;
  /** blob 型フィールド。PDS が blob を保持するために必要 */
  image?: ImageBlobRef;
  createdAt: ISODateString;
};

export type EdgeRecord = {
  $type: typeof NSID.edge;
  sheet: StrongRef;
  source: StrongRef;
  target: StrongRef;
  label?: string;
  properties?: unknown;
  createdAt: ISODateString;
};

export type NodeLayoutRecord = {
  $type: typeof NSID.nodeLayout;
  node: StrongRef;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  createdAt: ISODateString;
};

export type EdgeLayoutRecord = {
  $type: typeof NSID.edgeLayout;
  edge: StrongRef;
  sourceHandle?: string;
  targetHandle?: string;
  pathType?: 'bezier' | 'straight' | 'step' | 'smoothstep';
  labelOffsetX?: number;
  labelOffsetY?: number;
  createdAt: ISODateString;
};

export type RecordResult = { uri: AtUri; cid: string };

/** ポーリングで検出されたリモート変更 */
export type RemoteChange = {
  collection: string; // NSID (例: "app.conversensus.graph.node")
  rkey: Rkey; // レコードキー (例: nodeId)
  cid: string; // 新しい CID
  value: unknown; // PDS 上の最新レコード値
  changeType: 'add' | 'update'; // 新規追加 or 既存変更
};

export type BranchRecord = {
  $type: typeof NSID.branch;
  sheet: StrongRef;
  name: string;
  description?: string;
  authorDid: Did;
  status: 'creating' | 'open' | 'merged' | 'closed';
  baseCommit?: StrongRef;
  createdAt: ISODateString;
};

export type CommitRecord = {
  $type: typeof NSID.commit;
  sheet: StrongRef;
  branch: StrongRef;
  message: string;
  authorDid: Did;
  parentCommit?: StrongRef;
  operations: unknown[]; // CommitOperation[] を JSON として格納
  tree?: StrongRef[]; // commit 時点の Node/Edge レコードへの参照 (snapshot)
  createdAt: ISODateString;
};

export type MergeRecord = {
  $type: typeof NSID.merge;
  sheet: StrongRef;
  branch: StrongRef;
  message: string;
  authorDid: Did;
  commit?: StrongRef;
  createdAt: ISODateString;
};

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
