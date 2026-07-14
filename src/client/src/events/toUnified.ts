/**
 * GraphEvent → 統一イベント (Batch) のエンコーダ
 *
 * 現行 client 語彙 `GraphEvent` (19 種) が統一語彙の部分集合であることを示す。
 * 複合イベント (NODES_GROUPED / NODES_PASTED / NODE_REPARENTED 等) は
 * バッチモデルに従い、複数の基本 Op から成る 1 Batch に分解される。
 *
 * 既知の制約 (Phase 2 の配線で解消):
 *   - NODE_PROPERTIES_CHANGED.to は差分 (delta) だが、統一 op `node.setProperties` は
 *     置換 (full) 意味論。忠実な変換には capture 時に full properties が必要。
 *   - NODE_STYLE_CHANGED は現状 presentation 分類だが、実体は width/height の変更なので
 *     統一語彙では layout (`node.setLayout`) に正規化する (D7 の整理)。
 */

import type {
  EdgeId,
  EdgeLayout,
  Lamport,
  NodeId,
  NodeLayout,
  SheetId,
} from '@conversensus/shared';
import { type Batch, BatchIdSchema, type Op } from '@conversensus/shared';
import type { GraphEvent } from './GraphEvent';

function nodeLayoutOp(nodeId: NodeId, layout: NodeLayout | undefined): Op[] {
  if (!layout) return [];
  const { x, y, width, height } = layout;
  if (
    x === undefined &&
    y === undefined &&
    width === undefined &&
    height === undefined
  )
    return [];
  return [
    {
      kind: 'node.setLayout',
      target: nodeId,
      ...(x !== undefined && { x }),
      ...(y !== undefined && { y }),
      ...(width !== undefined && { width }),
      ...(height !== undefined && { height }),
    },
  ];
}

function edgeLayoutOp(edgeId: EdgeId, layout: EdgeLayout | undefined): Op[] {
  if (!layout) return [];
  const { sourceHandle, targetHandle, pathType } = layout;
  if (
    sourceHandle === undefined &&
    targetHandle === undefined &&
    pathType === undefined
  )
    return [];
  return [
    {
      kind: 'edge.setLayout',
      target: edgeId,
      ...(sourceHandle !== undefined && { sourceHandle }),
      ...(targetHandle !== undefined && { targetHandle }),
      ...(pathType !== undefined && { pathType }),
    },
  ];
}

/** GraphEvent を、それを構成する基本 Op 列へ分解する */
export function graphEventToOps(event: GraphEvent): Op[] {
  switch (event.type) {
    case 'NODE_ADDED':
      return [
        {
          kind: 'node.add',
          target: event.data.id,
          content: event.data.content,
          ...(event.data.properties && { properties: event.data.properties }),
          ...(event.data.nodeType && { nodeType: event.data.nodeType }),
          ...(event.data.parentId !== undefined && {
            parentId: event.data.parentId,
          }),
        },
        ...nodeLayoutOp(event.nodeId, event.layout),
      ];
    case 'NODE_DELETED':
      return [{ kind: 'node.remove', target: event.nodeId }];
    case 'EDGE_ADDED':
      return [
        {
          kind: 'edge.add',
          target: event.data.id,
          source: event.data.source,
          dest: event.data.target,
          ...(event.data.label !== undefined && { label: event.data.label }),
          ...(event.data.properties && { properties: event.data.properties }),
        },
        ...edgeLayoutOp(event.edgeId, event.edgeLayout),
      ];
    case 'EDGE_DELETED':
      return [{ kind: 'edge.remove', target: event.edgeId }];
    case 'EDGE_RECONNECTED':
      return [
        {
          kind: 'edge.reconnect',
          target: event.edgeId,
          source: event.to.source,
          dest: event.to.target,
          ...(event.to.sourceHandle !== undefined && {
            sourceHandle: event.to.sourceHandle,
          }),
          ...(event.to.targetHandle !== undefined && {
            targetHandle: event.to.targetHandle,
          }),
        },
      ];
    case 'NODE_REPARENTED':
      return [
        {
          kind: 'node.setParent',
          target: event.nodeId,
          ...(event.newParentId !== undefined && {
            parentId: event.newParentId,
          }),
        },
        {
          kind: 'node.setLayout',
          target: event.nodeId,
          x: event.newPosition.x,
          y: event.newPosition.y,
        },
      ];
    case 'NODES_GROUPED': {
      const ops: Op[] = [
        {
          kind: 'node.add',
          target: event.parentId,
          content: event.parentData.content,
          ...(event.parentData.nodeType && {
            nodeType: event.parentData.nodeType,
          }),
        },
        ...nodeLayoutOp(event.parentId, event.parentLayout),
      ];
      for (const child of event.children) {
        ops.push({
          kind: 'node.setParent',
          target: child.nodeId,
          parentId: event.parentId,
        });
        ops.push({
          kind: 'node.setLayout',
          target: child.nodeId,
          x: child.newPosition.x,
          y: child.newPosition.y,
        });
      }
      return ops;
    }
    case 'NODES_UNGROUPED': {
      const ops: Op[] = [];
      for (const child of event.children) {
        ops.push({
          kind: 'node.setParent',
          target: child.nodeId,
          ...(child.originalParentId !== undefined && {
            parentId: child.originalParentId,
          }),
        });
        ops.push({
          kind: 'node.setLayout',
          target: child.nodeId,
          x: child.originalPosition.x,
          y: child.originalPosition.y,
        });
      }
      ops.push({ kind: 'node.remove', target: event.parentId });
      return ops;
    }
    case 'NODES_PASTED': {
      const ops: Op[] = [];
      event.nodes.forEach((node, i) => {
        ops.push({
          kind: 'node.add',
          target: node.id,
          content: node.content,
          ...(node.properties && { properties: node.properties }),
          ...(node.nodeType && { nodeType: node.nodeType }),
          ...(node.parentId !== undefined && { parentId: node.parentId }),
        });
        ops.push(...nodeLayoutOp(node.id, event.layouts[i]));
      });
      event.edges.forEach((edge, i) => {
        ops.push({
          kind: 'edge.add',
          target: edge.id,
          source: edge.source,
          dest: edge.target,
          ...(edge.label !== undefined && { label: edge.label }),
          ...(edge.properties && { properties: edge.properties }),
        });
        ops.push(...edgeLayoutOp(edge.id, event.edgeLayouts[i]));
      });
      return ops;
    }
    case 'NODES_PASTED_UNDO': {
      const ops: Op[] = [];
      for (const edgeId of event.edgeIds)
        ops.push({ kind: 'edge.remove', target: edgeId });
      for (const nodeId of event.nodeIds)
        ops.push({ kind: 'node.remove', target: nodeId });
      return ops;
    }
    case 'NODE_RELABELED':
      return [
        { kind: 'node.setContent', target: event.nodeId, content: event.to },
      ];
    case 'EDGE_RELABELED':
      return [{ kind: 'edge.setLabel', target: event.edgeId, label: event.to }];
    case 'NODE_PROPERTIES_CHANGED':
      return [
        {
          kind: 'node.setProperties',
          target: event.nodeId,
          properties: event.to,
        },
      ];
    case 'EDGE_PROPERTIES_CHANGED':
      return [
        {
          kind: 'edge.setProperties',
          target: event.edgeId,
          properties: event.to,
        },
      ];
    case 'NODE_MOVED':
      return [
        {
          kind: 'node.setLayout',
          target: event.nodeId,
          x: event.to.x,
          y: event.to.y,
        },
      ];
    case 'NODE_RESIZED':
      return [
        {
          kind: 'node.setLayout',
          target: event.nodeId,
          width: event.to.width,
          height: event.to.height,
        },
      ];
    case 'NODE_STYLE_CHANGED': {
      // 実体は width/height の変更 → layout に正規化する
      const ops: Op[] = [];
      const { width, height } = event.to;
      if (width !== undefined || height !== undefined)
        ops.push({
          kind: 'node.setLayout',
          target: event.nodeId,
          ...(width !== undefined && { width }),
          ...(height !== undefined && { height }),
        });
      return ops;
    }
    case 'EDGE_STYLE_CHANGED':
      return [{ kind: 'edge.setStyle', target: event.edgeId, style: event.to }];
    case 'EDGE_LABEL_MOVED':
      return [
        {
          kind: 'edge.setLabelOffset',
          target: event.edgeId,
          offsetX: event.to.offsetX,
          offsetY: event.to.offsetY,
        },
      ];
    // file 構造 (W3c1): シート/ファイル構造イベント → file op
    case 'SHEET_CREATED':
      return [
        {
          kind: 'sheet.create',
          target: event.sheetId,
          name: event.name,
          ...(event.description !== undefined && {
            description: event.description,
          }),
        },
      ];
    case 'SHEET_REMOVED':
      return [{ kind: 'sheet.remove', target: event.sheetId }];
    case 'SHEET_RENAMED':
      return [
        { kind: 'sheet.setName', target: event.sheetId, name: event.name },
      ];
    case 'SHEET_DESCRIBED':
      return [
        {
          kind: 'sheet.setDescription',
          target: event.sheetId,
          ...(event.description !== undefined && {
            description: event.description,
          }),
        },
      ];
    case 'FILE_RENAMED':
      return [{ kind: 'file.setName', name: event.name }];
    case 'FILE_DESCRIBED':
      return [
        {
          kind: 'file.setDescription',
          ...(event.description !== undefined && {
            description: event.description,
          }),
        },
      ];
    default:
      return [];
  }
}

/**
 * GraphEvent を 1 つの Batch へ変換する (1 ユーザー操作 = 1 Batch)。
 * content 経路は `sheetId` (発生元シート) を渡し、structure (file) 経路は渡さない。
 * → file-level batch は sheetId を持たない (W3c2 §2.1)。
 */
export function graphEventToBatch(
  event: GraphEvent,
  clock: Lamport,
  sheetId?: SheetId,
): Batch {
  return {
    id: BatchIdSchema.parse(event.id),
    actor: event.userId,
    clock,
    timestamp: event.timestamp,
    ops: graphEventToOps(event),
    ...(sheetId !== undefined && { sheetId }),
  };
}
