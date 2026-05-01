import { z } from 'zod';

export const GROUP_NODE_TYPE = 'group' as const;
export const IMAGE_NODE_TYPE = 'image' as const;

// --- Branded ID schemas (UUID enforced at API boundaries) ---
export const NodeIdSchema = z.string().uuid().brand<'NodeId'>();
export const EdgeIdSchema = z.string().uuid().brand<'EdgeId'>();
export const SheetIdSchema = z.string().uuid().brand<'SheetId'>();
export const FileIdSchema = z.string().uuid().brand<'FileId'>();

// --- Branded ID types ---
export type NodeId = z.infer<typeof NodeIdSchema>;
export type EdgeId = z.infer<typeof EdgeIdSchema>;
export type SheetId = z.infer<typeof SheetIdSchema>;
export type FileId = z.infer<typeof FileIdSchema>;

// --- Primitive type aliases ---
export type NodeContent = string;
export type EdgeLabel = string;
export type FileName = string;
export type FileDescription = string;
export type SheetName = string;
export type ISODateString = string;
export type AtUri = string;
export type Rkey = string;
export type Did = string;

// --- Compound type schemas ---
export const StyleSchema = z.record(z.string(), z.unknown());
export type Style = z.infer<typeof StyleSchema>;

// ノードのレイアウトデータ: 座標・サイズ・種別を型安全に定義
// catchall で未知フィールドを保持し前方互換性を確保する
export const NodeLayoutSchema = z
  .object({
    nodeId: NodeIdSchema,
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.union([z.number(), z.string()]).optional(),
    height: z.union([z.number(), z.string()]).optional(),
  })
  .catchall(z.unknown());
export type NodeLayout = z.infer<typeof NodeLayoutSchema>;

// --- Domain schemas ---
export const GraphNodeSchema = z.object({
  id: NodeIdSchema,
  content: z.string(),
  properties: z.record(z.string(), z.unknown()).optional(),
  nodeType: z.enum([GROUP_NODE_TYPE, IMAGE_NODE_TYPE]).optional(),
  parentId: NodeIdSchema.optional(),
});

export const EdgePathTypeSchema = z.enum([
  'bezier',
  'straight',
  'step',
  'smoothstep',
]);
export type EdgePathType = z.infer<typeof EdgePathTypeSchema>;

// エッジのレイアウトデータ: 経路・ラベル位置・スタイルを型安全に定義
export const EdgeLayoutSchema = z
  .object({
    edgeId: EdgeIdSchema,
    sourceHandle: z.string().optional(),
    targetHandle: z.string().optional(),
    pathType: EdgePathTypeSchema.optional(),
    labelOffsetX: z.number().optional(),
    labelOffsetY: z.number().optional(),
    style: StyleSchema.optional(),
  })
  .catchall(z.unknown());
export type EdgeLayout = z.infer<typeof EdgeLayoutSchema>;

// セマンティックなグラフエッジ: source/target/label のみ保持
export const GraphEdgeSchema = z.object({
  id: EdgeIdSchema,
  source: NodeIdSchema,
  target: NodeIdSchema,
  label: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

export const SheetSchema = z.object({
  id: SheetIdSchema,
  name: z.string(),
  description: z.string().optional(),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  layouts: z.array(NodeLayoutSchema).optional(),
  edgeLayouts: z.array(EdgeLayoutSchema).optional(),
});

export const GraphFileSchema = z.object({
  id: FileIdSchema,
  name: z.string(),
  description: z.string().optional(),
  sheets: z.array(SheetSchema),
});

export const GraphFileListItemSchema = z.object({
  id: FileIdSchema,
  name: z.string(),
  description: z.string().optional(),
});

// --- Domain types (inferred from schemas) ---
export type GraphNode = z.infer<typeof GraphNodeSchema>;
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;
export type Sheet = z.infer<typeof SheetSchema>;
export type GraphFile = z.infer<typeof GraphFileSchema>;
export type GraphFileListItem = z.infer<typeof GraphFileListItemSchema>;

// --- Branch / Commit types (for ATProto version control) ---

export const BranchIdSchema = z.string().uuid().brand<'BranchId'>();
export type BranchId = z.infer<typeof BranchIdSchema>;

export const CommitIdSchema = z.string().uuid().brand<'CommitId'>();
export type CommitId = z.infer<typeof CommitIdSchema>;

export const CommitOperationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('node.add'),
    nodeId: z.string().uuid(),
    content: z.string(),
    properties: z.record(z.string(), z.unknown()).optional(),
    nodeType: z.enum([GROUP_NODE_TYPE, IMAGE_NODE_TYPE]).optional(),
    parentId: z.string().uuid().optional(),
  }),
  z.object({
    op: z.literal('node.update'),
    nodeId: z.string().uuid(),
    content: z.string().optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    parentId: z.string().uuid().optional(),
  }),
  z.object({ op: z.literal('node.remove'), nodeId: z.string().uuid() }),
  z.object({
    op: z.literal('edge.add'),
    edgeId: z.string().uuid(),
    sourceId: z.string().uuid(),
    targetId: z.string().uuid(),
    label: z.string().optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    op: z.literal('edge.update'),
    edgeId: z.string().uuid(),
    label: z.string().optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({ op: z.literal('edge.remove'), edgeId: z.string().uuid() }),
]);
export type CommitOperation = z.infer<typeof CommitOperationSchema>;

// --- Current file format ---
export const CONVERSENSUS_FILE_VERSION = '4' as const;

// .conversensus ファイル形式: GraphFile に version ヘッダを付与
export const ConversensusFileSchema = GraphFileSchema.extend({
  version: z.literal(CONVERSENSUS_FILE_VERSION),
});
export type ConversensusFile = z.infer<typeof ConversensusFileSchema>;
