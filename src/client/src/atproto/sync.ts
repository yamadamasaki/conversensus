/**
 * GraphFile / Sheet ↔ ATProto PDS の同期オーケストレーター
 *
 * 書き込み順序 (strongRef の依存関係に従う):
 *   1. sheet レコード       → sheetRef 取得
 *   2. node レコード (並列) → nodeRefs マップ構築
 *   3. edge レコード (並列、sourceRef/targetRef が必要)
 *   4. nodeLayout (並列、nodeRef + parentRef が必要)
 *   5. edgeLayout (並列、edgeRef が必要)
 */

import type { EdgeId, GraphFile, NodeId, Sheet } from '@conversensus/shared';
import {
  edgeLayouts,
  edges,
  nodeLayouts,
  nodes,
  rkeyFromUri,
  sheets,
} from './collections';
import {
  edgeLayoutToRecord,
  edgeToRecord,
  nodeLayoutToRecord,
  nodeToRecord,
  recordToEdge,
  recordToEdgeLayout,
  recordToNode,
  recordToNodeLayout,
  recordToSheetMeta,
  sheetToRecord,
} from './mapper';
import type {
  EdgeLayoutRecord,
  EdgeRecord,
  NodeLayoutRecord,
  NodeRecord,
  SheetRecord,
  StrongRef,
} from './types';

// --- 書き込み ---

/**
 * 既知の制限: 削除された node/edge/layout は PDS から削除されません。
 * 現状は追記/上書きのみで、差分削除は未実装です。
 * TODO: PDS 上の既存 rkey と現在の Sheet を比較し、不要レコードを deleteRecord する
 */
export async function syncSheetToAtproto(sheet: Sheet): Promise<void> {
  const now = new Date().toISOString();

  // 1. sheet レコードを put → sheetRef を取得
  const sheetResult = await sheets.put(sheet.id, sheetToRecord(sheet, now));
  const sheetRef: StrongRef = { uri: sheetResult.uri, cid: sheetResult.cid };

  // 2. 全 node を put (並列) → nodeId → StrongRef マップを構築
  const nodeRefs = new Map<string, StrongRef>();
  await Promise.all(
    sheet.nodes.map(async (node) => {
      const result = await nodes.put(
        node.id,
        nodeToRecord(node, sheetRef, now),
      );
      nodeRefs.set(node.id, { uri: result.uri, cid: result.cid });
    }),
  );

  // 3. 全 edge を put (並列、nodeRefs が確定してから)
  const edgeRefs = new Map<string, StrongRef>();
  await Promise.all(
    sheet.edges.map(async (edge) => {
      const sourceRef = nodeRefs.get(edge.source);
      const targetRef = nodeRefs.get(edge.target);
      if (!sourceRef || !targetRef) {
        console.warn(
          `syncSheetToAtproto: edge ${edge.id} の source/target が見つかりません`,
        );
        return;
      }
      const result = await edges.put(
        edge.id,
        edgeToRecord(edge, sheetRef, sourceRef, targetRef, now),
      );
      edgeRefs.set(edge.id, { uri: result.uri, cid: result.cid });
    }),
  );

  // 4. nodeLayout を put (並列)
  if (sheet.layouts && sheet.layouts.length > 0) {
    await Promise.all(
      sheet.layouts.map(async (layout) => {
        const nodeRef = nodeRefs.get(layout.nodeId);
        if (!nodeRef) return;
        const parentRef = layout.parentId
          ? nodeRefs.get(layout.parentId)
          : undefined;
        await nodeLayouts.put(
          layout.nodeId,
          nodeLayoutToRecord(layout, nodeRef, parentRef, now),
        );
      }),
    );
  }

  // 5. edgeLayout を put (並列)
  if (sheet.edgeLayouts && sheet.edgeLayouts.length > 0) {
    await Promise.all(
      sheet.edgeLayouts.map(async (layout) => {
        const edgeRef = edgeRefs.get(layout.edgeId);
        if (!edgeRef) return;
        await edgeLayouts.put(
          layout.edgeId,
          edgeLayoutToRecord(layout, edgeRef, now),
        );
      }),
    );
  }
}

export async function syncFileToAtproto(file: GraphFile): Promise<void> {
  // 各シートを順次同期 (シート間に依存関係はないが並列にしすぎると PDS 負荷が高い)
  for (const sheet of file.sheets) {
    await syncSheetToAtproto(sheet);
  }
}

// --- 読み込み ---

export async function fetchSheetsFromAtproto(): Promise<Sheet[]> {
  // 全コレクションを並列取得
  const [
    sheetRecords,
    nodeRecords,
    edgeRecords,
    nodeLayoutRecords,
    edgeLayoutRecords,
  ] = await Promise.all([
    sheets.list(),
    nodes.list(),
    edges.list(),
    nodeLayouts.list(),
    edgeLayouts.list(),
  ]);

  return sheetRecords.map((sheetEntry) => {
    const sheetRkey = rkeyFromUri(sheetEntry.uri);
    const sheetRecord = sheetEntry.value as SheetRecord;
    const sheetMeta = recordToSheetMeta(sheetRkey, sheetRecord);

    // sheetId が一致するレコードだけ抽出
    const sheetNodeEntries = nodeRecords.filter(
      (r) => rkeyFromUri((r.value as NodeRecord).sheet.uri) === sheetRkey,
    );
    const sheetEdgeEntries = edgeRecords.filter(
      (r) => rkeyFromUri((r.value as EdgeRecord).sheet.uri) === sheetRkey,
    );

    const sheetNodes = sheetNodeEntries.map((r) =>
      recordToNode(rkeyFromUri(r.uri), r.value as NodeRecord),
    );
    const sheetEdges = sheetEdgeEntries.map((r) =>
      recordToEdge(rkeyFromUri(r.uri), r.value as EdgeRecord),
    );

    // nodeLayout: rkey = nodeId なので sheetNodes のIDで照合
    const sheetNodeIds = new Set(sheetNodes.map((n) => n.id));
    const sheetLayouts = nodeLayoutRecords
      .filter((r) => sheetNodeIds.has(rkeyFromUri(r.uri) as NodeId))
      .map((r) =>
        recordToNodeLayout(rkeyFromUri(r.uri), r.value as NodeLayoutRecord),
      );

    // edgeLayout: rkey = edgeId
    const sheetEdgeIds = new Set(sheetEdges.map((e) => e.id));
    const sheetEdgeLayouts = edgeLayoutRecords
      .filter((r) => sheetEdgeIds.has(rkeyFromUri(r.uri) as EdgeId))
      .map((r) =>
        recordToEdgeLayout(rkeyFromUri(r.uri), r.value as EdgeLayoutRecord),
      );

    return {
      ...sheetMeta,
      nodes: sheetNodes,
      edges: sheetEdges,
      layouts: sheetLayouts.length > 0 ? sheetLayouts : undefined,
      edgeLayouts: sheetEdgeLayouts.length > 0 ? sheetEdgeLayouts : undefined,
    };
  });
}
