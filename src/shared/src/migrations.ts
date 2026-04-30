import { z } from 'zod';
import {
  type ConversensusFile,
  EdgeIdSchema,
  EdgeLayoutSchema,
  EdgePathTypeSchema,
  FileIdSchema,
  GraphEdgeSchema,
  GraphFileSchema,
  GraphNodeSchema,
  type NodeId,
  NodeIdSchema,
  type NodeLayout,
  SheetIdSchema,
  SheetSchema,
  StyleSchema,
} from './schemas';

// --- v1 互換スキーマ (マイグレーション専用) ---

// v1 ノードスタイル: 座標・サイズ・グループ種別を直接持つ (v2 で NodeLayout に分離)
const NodeStyleSchema = z
  .object({
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.union([z.number(), z.string()]).optional(),
    height: z.union([z.number(), z.string()]).optional(),
    nodeType: z.literal('group').optional(),
  })
  .catchall(z.unknown());

// v1 ノード: style フィールドにレイアウト情報を含む
const GraphNodeV1Schema = z.object({
  id: NodeIdSchema,
  content: z.string(),
  parentId: NodeIdSchema.optional(),
  style: NodeStyleSchema.optional(),
});

// v1 エッジ: レイアウト情報を直接含む (v2 で EdgeLayout に分離)
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

// --- v2 互換スキーマ (マイグレーション専用) ---

// v2 ノード: parentId がセマンティック層に残存 (v3 で NodeLayout に移動)
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

// --- v3 互換スキーマ (マイグレーション専用) ---

// v3 ノード: nodeType と parentId なし (v4 で GraphNode に追加)
const GraphNodeV3Schema = z.object({
  id: NodeIdSchema,
  content: z.string(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

// v3 レイアウト: nodeType と parentId を含む (v4 で NodeLayout から削除)
const NodeLayoutV3Schema = z
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

const SheetV3Schema = z.object({
  id: SheetIdSchema,
  name: z.string(),
  description: z.string().optional(),
  nodes: z.array(GraphNodeV3Schema),
  edges: z.array(GraphEdgeSchema),
  layouts: z.array(NodeLayoutV3Schema).optional(),
  edgeLayouts: z.array(EdgeLayoutSchema).optional(),
});

const GraphFileV3Schema = z.object({
  id: FileIdSchema,
  name: z.string(),
  description: z.string().optional(),
  sheets: z.array(SheetV3Schema),
});

export const ConversensusFileV3Schema = GraphFileV3Schema.extend({
  version: z.literal('3'),
});
export type ConversensusFileV3 = z.infer<typeof ConversensusFileV3Schema>;

// --- マイグレーション関数 ---

// v1 → v2: style/エッジレイアウトフィールドを NodeLayout/EdgeLayout に分離
export function migrateV1toV2(file: ConversensusFileV1): ConversensusFileV2 {
  return {
    ...file,
    version: '2',
    sheets: file.sheets.map((sheet) => {
      const layouts = sheet.nodes
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
      const edgeLayouts = sheet.edges
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

// v3 → v4: nodeType/parentId をレイアウトからセマンティックノードに移動
export function migrateV3toV4(file: ConversensusFileV3): ConversensusFile {
  return {
    ...file,
    version: '4',
    sheets: file.sheets.map((sheet) => {
      // レイアウトから nodeType と parentId を収集
      const nodeMetaMap = new Map<
        string,
        { nodeType?: 'group'; parentId?: NodeId }
      >(
        (sheet.layouts ?? [])
          .filter((l) => l.nodeType !== undefined || l.parentId !== undefined)
          .map((l) => [
            l.nodeId as string,
            {
              ...(l.nodeType !== undefined ? { nodeType: l.nodeType } : {}),
              ...(l.parentId !== undefined ? { parentId: l.parentId } : {}),
            },
          ]),
      );
      return {
        ...sheet,
        nodes: sheet.nodes.map((n) => ({
          ...n,
          ...(nodeMetaMap.get(n.id as string) ?? {}),
        })),
        layouts: (sheet.layouts ?? []).map(
          ({ nodeType: _nt, parentId: _pid, ...rest }) => rest,
        ),
      };
    }),
  };
}

// v2 → v3: parentId をセマンティックノードからレイアウトに移動
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
