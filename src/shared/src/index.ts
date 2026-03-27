import { z } from 'zod';

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

// --- Compound type schemas ---
export const StyleSchema = z.record(z.string(), z.unknown());
export type Style = z.infer<typeof StyleSchema>;

// ノードの永続化スタイル: 座標・サイズ・種別を型安全に定義
// catchall で未知フィールドを保持し前方互換性を確保する
export const NodeStyleSchema = z
  .object({
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.union([z.number(), z.string()]).optional(),
    height: z.union([z.number(), z.string()]).optional(),
    nodeType: z.literal('group').optional(),
  })
  .catchall(z.unknown());
export type NodeStyle = z.infer<typeof NodeStyleSchema>;

// --- Domain schemas ---
export const GraphNodeSchema = z.object({
  id: NodeIdSchema,
  content: z.string(),
  parentId: NodeIdSchema.optional(),
  style: NodeStyleSchema.optional(),
});

export const EdgePathTypeSchema = z.enum([
  'bezier',
  'straight',
  'step',
  'smoothstep',
]);
export type EdgePathType = z.infer<typeof EdgePathTypeSchema>;

export const GraphEdgeSchema = z.object({
  id: EdgeIdSchema,
  source: NodeIdSchema,
  target: NodeIdSchema,
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  label: z.string().optional(),
  pathType: EdgePathTypeSchema.optional(),
  labelOffsetX: z.number().optional(),
  labelOffsetY: z.number().optional(),
  style: StyleSchema.optional(),
});

export const SheetSchema = z.object({
  id: SheetIdSchema,
  name: z.string(),
  description: z.string().optional(),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
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

// --- HTTP API request/response schemas ---
export const CreateFileRequestSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  sheet: z.object({ name: z.string().optional() }).optional(),
});
export type CreateFileRequest = z.infer<typeof CreateFileRequestSchema>;

export const UpdateFileRequestSchema = GraphFileSchema;
export type UpdateFileRequest = z.infer<typeof UpdateFileRequestSchema>;
