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

// ノードのレイアウトデータ: 座標・サイズ・種別を型安全に定義
// catchall で未知フィールドを保持し前方互換性を確保する
export const NodeLayoutSchema = z
  .object({
    nodeId: NodeIdSchema,
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.union([z.number(), z.string()]).optional(),
    height: z.union([z.number(), z.string()]).optional(),
    nodeType: z.literal('group').optional(),
  })
  .catchall(z.unknown());
export type NodeLayout = z.infer<typeof NodeLayoutSchema>;

// @deprecated v1 互換のため残存。新規コードでは NodeLayoutSchema を使用すること
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
  layouts: z.array(NodeLayoutSchema).optional(),
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

// --- Import/Export file format ---
export const CONVERSENSUS_FILE_VERSION = '2' as const;

// .conversensus ファイル形式: GraphFile に version ヘッダを付与
export const ConversensusFileSchema = GraphFileSchema.extend({
  version: z.literal(CONVERSENSUS_FILE_VERSION),
});
export type ConversensusFile = z.infer<typeof ConversensusFileSchema>;

// --- v1 スキーマ (マイグレーション用) ---
const GraphNodeV1Schema = z.object({
  id: NodeIdSchema,
  content: z.string(),
  parentId: NodeIdSchema.optional(),
  style: NodeStyleSchema.optional(),
});

const SheetV1Schema = z.object({
  id: SheetIdSchema,
  name: z.string(),
  description: z.string().optional(),
  nodes: z.array(GraphNodeV1Schema),
  edges: z.array(GraphEdgeSchema),
});

const GraphFileV1Schema = z.object({
  id: FileIdSchema,
  name: z.string(),
  description: z.string().optional(),
  sheets: z.array(SheetV1Schema),
});

export const ConversensusFileV1Schema = GraphFileV1Schema.extend({
  version: z.literal('1' as const),
});
export type ConversensusFileV1 = z.infer<typeof ConversensusFileV1Schema>;

// --- マイグレーション ---
export function migrateV1toV2(file: ConversensusFileV1): ConversensusFile {
  return {
    ...file,
    version: '2',
    sheets: file.sheets.map((sheet) => {
      const layouts: NodeLayout[] = sheet.nodes
        .filter((n) => n.style !== undefined)
        .map((n) => ({
          nodeId: n.id,
          x: n.style?.x,
          y: n.style?.y,
          width: n.style?.width,
          height: n.style?.height,
          nodeType: n.style?.nodeType,
        }));
      return {
        ...sheet,
        nodes: sheet.nodes.map(({ id, content, parentId }) => ({
          id,
          content,
          parentId,
        })),
        layouts: layouts.length > 0 ? layouts : undefined,
      };
    }),
  };
}

// --- HTTP API request/response schemas ---
export const CreateFileRequestSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  sheet: z.object({ name: z.string().optional() }).optional(),
});
export type CreateFileRequest = z.infer<typeof CreateFileRequestSchema>;

export const UpdateFileRequestSchema = GraphFileSchema;
export type UpdateFileRequest = z.infer<typeof UpdateFileRequestSchema>;
