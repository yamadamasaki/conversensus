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
    parentId: NodeIdSchema.optional(),
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
  properties: z.record(z.string(), z.unknown()).optional(),
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

// --- Import/Export file format ---
export const CONVERSENSUS_FILE_VERSION = '3' as const;

// .conversensus ファイル形式: GraphFile に version ヘッダを付与
export const ConversensusFileSchema = GraphFileSchema.extend({
  version: z.literal(CONVERSENSUS_FILE_VERSION),
});
export type ConversensusFile = z.infer<typeof ConversensusFileSchema>;

// --- v2 スキーマ (マイグレーション用) ---
// v2: parentId はノードに存在する (レイアウトへの移動前)
const GraphNodeV2Schema = GraphNodeSchema.extend({
  parentId: NodeIdSchema.optional(),
});
const SheetV2Schema = SheetSchema.extend({
  nodes: z.array(GraphNodeV2Schema),
});
const GraphFileV2Schema = GraphFileSchema.extend({
  sheets: z.array(SheetV2Schema),
});
export const ConversensusFileV2Schema = GraphFileV2Schema.extend({
  version: z.literal('2'),
});
export type ConversensusFileV2 = z.infer<typeof ConversensusFileV2Schema>;

// --- v1 スキーマ (マイグレーション用) ---
const GraphNodeV1Schema = z.object({
  id: NodeIdSchema,
  content: z.string(),
  parentId: NodeIdSchema.optional(),
  style: NodeStyleSchema.optional(),
});

// v1 エッジはレイアウト情報を直接含む
const GraphEdgeV1Schema = z.object({
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

const SheetV1Schema = z.object({
  id: SheetIdSchema,
  name: z.string(),
  description: z.string().optional(),
  nodes: z.array(GraphNodeV1Schema),
  edges: z.array(GraphEdgeV1Schema),
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
export function migrateV1toV2(file: ConversensusFileV1): ConversensusFileV2 {
  return {
    ...file,
    version: '2',
    sheets: file.sheets.map((sheet) => {
      const layouts: NodeLayout[] = sheet.nodes
        .filter((n) => n.style !== undefined)
        .map((n) => ({
          nodeId: n.id,
          ...(n.style?.x !== undefined ? { x: n.style.x } : {}),
          ...(n.style?.y !== undefined ? { y: n.style.y } : {}),
          ...(n.style?.width !== undefined ? { width: n.style.width } : {}),
          ...(n.style?.height !== undefined ? { height: n.style.height } : {}),
          ...(n.style?.nodeType !== undefined
            ? { nodeType: n.style.nodeType }
            : {}),
        }));
      const edgeLayouts: EdgeLayout[] = sheet.edges
        .filter(
          (e) =>
            e.sourceHandle !== undefined ||
            e.targetHandle !== undefined ||
            e.pathType !== undefined ||
            e.labelOffsetX !== undefined ||
            e.labelOffsetY !== undefined ||
            e.style !== undefined,
        )
        .map((e) => ({
          edgeId: e.id,
          ...(e.sourceHandle !== undefined
            ? { sourceHandle: e.sourceHandle }
            : {}),
          ...(e.targetHandle !== undefined
            ? { targetHandle: e.targetHandle }
            : {}),
          ...(e.pathType !== undefined ? { pathType: e.pathType } : {}),
          ...(e.labelOffsetX !== undefined
            ? { labelOffsetX: e.labelOffsetX }
            : {}),
          ...(e.labelOffsetY !== undefined
            ? { labelOffsetY: e.labelOffsetY }
            : {}),
          ...(e.style !== undefined ? { style: e.style } : {}),
        }));
      return {
        ...sheet,
        nodes: sheet.nodes.map(({ id, content, parentId }) => ({
          id,
          content,
          parentId,
        })),
        edges: sheet.edges.map(({ id, source, target, label }) => ({
          id,
          source,
          target,
          label,
        })),
        layouts: layouts.length > 0 ? layouts : undefined,
        edgeLayouts: edgeLayouts.length > 0 ? edgeLayouts : undefined,
      };
    }),
  };
}

export function migrateV2toV3(file: ConversensusFileV2): ConversensusFile {
  return {
    ...file,
    version: '3',
    sheets: file.sheets.map((sheet) => {
      // ノードの parentId を nodeId → parentId のマップとして収集
      const nodeParentMap = new Map<string, NodeId>(
        sheet.nodes
          .filter((n) => n.parentId !== undefined)
          .map((n) => [n.id as string, n.parentId as NodeId]),
      );
      const existingLayoutIds = new Set(
        (sheet.layouts ?? []).map((l) => l.nodeId as string),
      );
      const updatedLayouts: NodeLayout[] = [
        // 既存レイアウトに parentId をマージ
        ...(sheet.layouts ?? []).map((l) => ({
          ...l,
          ...(nodeParentMap.has(l.nodeId as string)
            ? { parentId: nodeParentMap.get(l.nodeId as string) }
            : {}),
        })),
        // parentId を持つがレイアウトエントリが存在しないノードの新規エントリ
        ...Array.from(nodeParentMap.entries())
          .filter(([nodeId]) => !existingLayoutIds.has(nodeId))
          .map(([nodeId, parentId]) => ({
            nodeId: nodeId as NodeId,
            parentId,
          })),
      ];
      return {
        ...sheet,
        nodes: sheet.nodes.map(({ parentId: _parentId, ...rest }) => rest),
        layouts: updatedLayouts.length > 0 ? updatedLayouts : undefined,
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
