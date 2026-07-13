import type { AtUri, Did, ISODateString, Rkey } from '@conversensus/shared';

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
  actor: string;
  clock: number;
  timestamp: number;
  ops: unknown[]; // Op[] を JSON として格納 (records は任意 JSON を許容)
  createdAt: ISODateString;
};
