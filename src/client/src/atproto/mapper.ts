/**
 * ドメイン型 ↔ ATProto レコード型の相互変換
 *
 * 設計方針:
 * - ネットワーク呼び出しを一切行わない純粋関数
 * - StrongRef は呼び出し側が事前に用意する (put 結果 or ref() で取得)
 * - rkey = ドメイン ID (UUID 文字列)
 */

import type {
  EdgeLayout,
  FileId,
  GraphEdge,
  GraphFile,
  GraphNode,
  NodeLayout,
  Rkey,
  Sheet,
} from '@conversensus/shared';
import {
  EdgeIdSchema,
  FileIdSchema,
  NodeIdSchema,
  SheetIdSchema,
} from '@conversensus/shared';
import { idFromRkey, rkeyFromUri } from './collections';
import type {
  EdgeLayoutRecord,
  EdgeRecord,
  FileRecord,
  NodeLayoutRecord,
  NodeRecord,
  SheetRecord,
  StrongRef,
} from './types';

// --- ドメイン → ATProto レコード ---

export function fileToRecord(
  file: Pick<GraphFile, 'name' | 'description'>,
  createdAt = new Date().toISOString(),
): Omit<FileRecord, '$type'> {
  return {
    name: file.name,
    ...(file.description !== undefined && { description: file.description }),
    createdAt,
  };
}

export function sheetToRecord(
  sheet: Pick<Sheet, 'name' | 'description'>,
  createdAt = new Date().toISOString(),
  fileRef?: StrongRef,
): Omit<SheetRecord, '$type'> {
  return {
    name: sheet.name,
    ...(sheet.description !== undefined && { description: sheet.description }),
    ...(fileRef !== undefined && { file: fileRef }),
    createdAt,
  };
}

export function nodeToRecord(
  node: GraphNode,
  sheetRef: StrongRef,
  parentRef?: StrongRef,
  createdAt = new Date().toISOString(),
): Omit<NodeRecord, '$type'> {
  const props = node.properties as Record<string, unknown> | undefined;
  // blob 参照を抽出（PDS が blob を保持するために $type: 'blob' のフィールドが必要）
  const imageBlob = props?.imageBlobCid
    ? {
        $type: 'blob' as const,
        ref: { $link: props.imageBlobCid as string },
        mimeType: (props.imageBlobMimeType as string) ?? 'image/png',
        size: (props.imageBlobSize as number) ?? 0,
      }
    : undefined;
  if (imageBlob) {
    console.log('[mapper] nodeToRecord image blob:', imageBlob.ref.$link);
  }
  if (props?.imageDataUrl) {
    console.log(
      '[mapper] nodeToRecord imageDataUrl length:',
      (props.imageDataUrl as string).length,
    );
  }
  return {
    sheet: sheetRef,
    content: node.content,
    ...(node.properties !== undefined && { properties: node.properties }),
    ...(imageBlob !== undefined && { image: imageBlob }),
    ...(node.nodeType !== undefined && { nodeType: node.nodeType }),
    ...(parentRef !== undefined && { parent: parentRef }),
    createdAt,
  };
}

export function edgeToRecord(
  edge: GraphEdge,
  sheetRef: StrongRef,
  sourceRef: StrongRef,
  targetRef: StrongRef,
  createdAt = new Date().toISOString(),
): Omit<EdgeRecord, '$type'> {
  return {
    sheet: sheetRef,
    source: sourceRef,
    target: targetRef,
    ...(edge.label !== undefined && { label: edge.label }),
    ...(edge.properties !== undefined && { properties: edge.properties }),
    createdAt,
  };
}

// ATProto は integer のみ。number | string を整数に変換する
function toInt(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Math.round(Number(value));
  return Number.isNaN(n) ? undefined : n;
}

export function nodeLayoutToRecord(
  layout: NodeLayout,
  nodeRef: StrongRef,
  createdAt = new Date().toISOString(),
): Omit<NodeLayoutRecord, '$type'> {
  return {
    node: nodeRef,
    ...(layout.x !== undefined && { x: Math.round(layout.x) }),
    ...(layout.y !== undefined && { y: Math.round(layout.y) }),
    ...(layout.width !== undefined && { width: toInt(layout.width) }),
    ...(layout.height !== undefined && { height: toInt(layout.height) }),
    createdAt,
  };
}

/**
 * 既知の制限: EdgeLayout / NodeLayout は .catchall(z.unknown()) を持つため
 * lexicon に定義されていない追加フィールド (style など) は ATProto ラウンドトリップで失われます。
 * 必要になった時点で lexicon と mapper を拡張してください。
 */
export function edgeLayoutToRecord(
  layout: EdgeLayout,
  edgeRef: StrongRef,
  createdAt = new Date().toISOString(),
): Omit<EdgeLayoutRecord, '$type'> {
  return {
    edge: edgeRef,
    ...(layout.sourceHandle !== undefined && {
      sourceHandle: layout.sourceHandle,
    }),
    ...(layout.targetHandle !== undefined && {
      targetHandle: layout.targetHandle,
    }),
    ...(layout.pathType !== undefined && { pathType: layout.pathType }),
    ...(layout.labelOffsetX !== undefined && {
      labelOffsetX: Math.round(layout.labelOffsetX),
    }),
    ...(layout.labelOffsetY !== undefined && {
      labelOffsetY: Math.round(layout.labelOffsetY),
    }),
    createdAt,
  };
}

// --- ATProto レコード → ドメイン ---

export function recordToNode(rkey: Rkey, record: NodeRecord): GraphNode {
  const props = (record.properties as Record<string, unknown>) ?? {};
  // blob 参照から CID/mimeType/size を抽出して properties に設定
  if (record.image) {
    console.log('[mapper] recordToNode image blob:', record.image.ref.$link);
    props.imageBlobCid = record.image.ref.$link;
    props.imageBlobMimeType = record.image.mimeType;
    props.imageBlobSize = record.image.size;
  }
  if (props.imageDataUrl) {
    console.log(
      '[mapper] recordToNode imageDataUrl length:',
      (props.imageDataUrl as string).length,
    );
  }
  return {
    id: NodeIdSchema.parse(idFromRkey(rkey)),
    content: record.content,
    ...(Object.keys(props).length > 0 ? { properties: props } : {}),
    ...(record.nodeType !== undefined && { nodeType: record.nodeType }),
    ...(record.parent !== undefined && {
      parentId: NodeIdSchema.parse(idFromRkey(rkeyFromUri(record.parent.uri))),
    }),
  };
}

export function recordToEdge(rkey: Rkey, record: EdgeRecord): GraphEdge {
  return {
    id: EdgeIdSchema.parse(idFromRkey(rkey)),
    source: NodeIdSchema.parse(idFromRkey(rkeyFromUri(record.source.uri))),
    target: NodeIdSchema.parse(idFromRkey(rkeyFromUri(record.target.uri))),
    ...(record.label !== undefined && { label: record.label }),
    ...(record.properties !== undefined && {
      properties: record.properties as Record<string, unknown>,
    }),
  };
}

export function recordToNodeLayout(
  rkey: Rkey,
  record: NodeLayoutRecord,
): NodeLayout {
  return {
    nodeId: NodeIdSchema.parse(idFromRkey(rkey)),
    ...(record.x !== undefined && { x: record.x }),
    ...(record.y !== undefined && { y: record.y }),
    ...(record.width !== undefined && { width: record.width }),
    ...(record.height !== undefined && { height: record.height }),
  };
}

export function recordToEdgeLayout(
  rkey: Rkey,
  record: EdgeLayoutRecord,
): EdgeLayout {
  return {
    edgeId: EdgeIdSchema.parse(idFromRkey(rkey)),
    ...(record.sourceHandle !== undefined && {
      sourceHandle: record.sourceHandle,
    }),
    ...(record.targetHandle !== undefined && {
      targetHandle: record.targetHandle,
    }),
    ...(record.pathType !== undefined && { pathType: record.pathType }),
    ...(record.labelOffsetX !== undefined && {
      labelOffsetX: record.labelOffsetX,
    }),
    ...(record.labelOffsetY !== undefined && {
      labelOffsetY: record.labelOffsetY,
    }),
  };
}

export function recordToSheetMeta(
  rkey: Rkey,
  record: SheetRecord,
): Pick<Sheet, 'id' | 'name' | 'description'> {
  return {
    id: SheetIdSchema.parse(rkey),
    name: record.name,
    ...(record.description !== undefined && {
      description: record.description,
    }),
  };
}

export function recordToFileMeta(
  rkey: Rkey,
  record: FileRecord,
): Pick<GraphFile, 'id' | 'name' | 'description'> & { id: FileId } {
  return {
    id: FileIdSchema.parse(rkey),
    name: record.name,
    ...(record.description !== undefined && {
      description: record.description,
    }),
  };
}
