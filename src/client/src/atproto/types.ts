// ATProto strongRef: uri (AT-URI) + cid (content hash)
export type StrongRef = { uri: string; cid: string };

// Lexicon NSID 定数
export const NSID = {
  sheet: 'app.conversensus.graph.sheet',
  node: 'app.conversensus.graph.node',
  edge: 'app.conversensus.graph.edge',
  nodeLayout: 'app.conversensus.graph.nodeLayout',
  edgeLayout: 'app.conversensus.graph.edgeLayout',
} as const;

export type SheetRecord = {
  $type: typeof NSID.sheet;
  name: string;
  description?: string;
  createdAt: string;
};

export type NodeRecord = {
  $type: typeof NSID.node;
  sheet: StrongRef;
  content: string;
  properties?: unknown;
  createdAt: string;
};

export type EdgeRecord = {
  $type: typeof NSID.edge;
  sheet: StrongRef;
  source: StrongRef;
  target: StrongRef;
  label?: string;
  properties?: unknown;
  createdAt: string;
};

export type NodeLayoutRecord = {
  $type: typeof NSID.nodeLayout;
  node: StrongRef;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  nodeType?: 'group';
  parent?: StrongRef;
  createdAt: string;
};

export type EdgeLayoutRecord = {
  $type: typeof NSID.edgeLayout;
  edge: StrongRef;
  sourceHandle?: string;
  targetHandle?: string;
  pathType?: 'bezier' | 'straight' | 'step' | 'smoothstep';
  labelOffsetX?: number;
  labelOffsetY?: number;
  createdAt: string;
};

export type RecordResult = { uri: string; cid: string };

/** ポーリングで検出されたリモート変更 */
export type RemoteChange = {
  collection: string; // NSID (例: "app.conversensus.graph.node")
  rkey: string; // レコードキー (例: nodeId)
  cid: string; // 新しい CID
  value: unknown; // PDS 上の最新レコード値
};
