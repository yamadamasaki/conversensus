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

import type { GraphFile, GraphFileListItem, Sheet } from '@conversensus/shared';
import { cacheResult, getCreatedAt } from './cidCache';
import {
  edgeLayouts,
  edges,
  files,
  idFromRkey,
  makeRkey,
  nodeLayouts,
  nodes,
  prefixFromRkey,
  rkeyFromUri,
  sheets,
  TRUNK_PREFIX,
} from './collections';
import {
  edgeLayoutToRecord,
  edgeToRecord,
  fileToRecord,
  nodeLayoutToRecord,
  nodeToRecord,
  recordToEdge,
  recordToEdgeLayout,
  recordToFileMeta,
  recordToNode,
  recordToNodeLayout,
  recordToSheetMeta,
  sheetToRecord,
} from './mapper';
import type {
  EdgeLayoutRecord,
  EdgeRecord,
  FileRecord,
  NodeLayoutRecord,
  NodeRecord,
  SheetRecord,
  StrongRef,
} from './types';
import { NSID } from './types';

// --- 書き込み ---

/**
 * 既知の制限: 削除された node/edge/layout は PDS から削除されません。
 * 現状は追記/上書きのみで、差分削除は未実装です。
 * TODO: PDS 上の既存 rkey と現在の Sheet を比較し、不要レコードを deleteRecord する
 */
export async function syncSheetToAtproto(
  sheet: Sheet,
  fileRef?: StrongRef,
): Promise<void> {
  const now = new Date().toISOString();

  // 各レコードの createdAt は PDS から取得した値を優先して使う。
  // 同じデータを再 sync しても CID が変わらないようにするため。

  // 1. sheet レコードを put → sheetRef を取得
  const sheetCreatedAt = getCreatedAt(NSID.sheet, sheet.id) ?? now;
  const sheetResult = await sheets.put(
    sheet.id,
    sheetToRecord(sheet, sheetCreatedAt, fileRef),
  );
  cacheResult(sheetResult.uri, sheetResult.cid, sheetCreatedAt);
  const sheetRef: StrongRef = { uri: sheetResult.uri, cid: sheetResult.cid };

  // 2. 全 node を put (並列) → nodeId → StrongRef マップを構築
  // rkey = "trunk_{nodeId}" 形式 (branch node と区別するため)
  const nodeRefs = new Map<string, StrongRef>();
  await Promise.all(
    sheet.nodes.map(async (node) => {
      const rkey = makeRkey(TRUNK_PREFIX, node.id);
      const nodeCreatedAt = getCreatedAt(NSID.node, rkey) ?? now;
      const result = await nodes.put(
        rkey,
        nodeToRecord(node, sheetRef, nodeCreatedAt),
      );
      cacheResult(result.uri, result.cid, nodeCreatedAt);
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
      const rkey = makeRkey(TRUNK_PREFIX, edge.id);
      const edgeCreatedAt = getCreatedAt(NSID.edge, rkey) ?? now;
      const result = await edges.put(
        rkey,
        edgeToRecord(edge, sheetRef, sourceRef, targetRef, edgeCreatedAt),
      );
      cacheResult(result.uri, result.cid, edgeCreatedAt);
      edgeRefs.set(edge.id, { uri: result.uri, cid: result.cid });
    }),
  );

  // 4. nodeLayout を put (並列)
  if (sheet.layouts && sheet.layouts.length > 0) {
    await Promise.all(
      sheet.layouts.map(async (layout) => {
        const nodeRef = nodeRefs.get(layout.nodeId);
        if (!nodeRef) return;
        const rkey = makeRkey(TRUNK_PREFIX, layout.nodeId);
        const layoutCreatedAt = getCreatedAt(NSID.nodeLayout, rkey) ?? now;
        const r = await nodeLayouts.put(
          rkey,
          nodeLayoutToRecord(layout, nodeRef, layoutCreatedAt),
        );
        cacheResult(r.uri, r.cid, layoutCreatedAt);
      }),
    );
  }

  // 5. edgeLayout を put (並列)
  if (sheet.edgeLayouts && sheet.edgeLayouts.length > 0) {
    await Promise.all(
      sheet.edgeLayouts.map(async (layout) => {
        const edgeRef = edgeRefs.get(layout.edgeId);
        if (!edgeRef) return;
        const rkey = makeRkey(TRUNK_PREFIX, layout.edgeId);
        const layoutCreatedAt = getCreatedAt(NSID.edgeLayout, rkey) ?? now;
        const r = await edgeLayouts.put(
          rkey,
          edgeLayoutToRecord(layout, edgeRef, layoutCreatedAt),
        );
        cacheResult(r.uri, r.cid, layoutCreatedAt);
      }),
    );
  }
}

export async function syncFileToAtproto(file: GraphFile): Promise<void> {
  const now = new Date().toISOString();

  // 1. file レコードを put → fileRef を取得
  const fileCreatedAt = getCreatedAt(NSID.file, file.id) ?? now;
  const fileResult = await files.put(
    file.id,
    fileToRecord(file, fileCreatedAt),
  );
  cacheResult(fileResult.uri, fileResult.cid, fileCreatedAt);
  const fileRef: StrongRef = { uri: fileResult.uri, cid: fileResult.cid };

  // 2. 各シートを順次同期 (fileRef を渡してシート→ファイルの参照を記録)
  for (const sheet of file.sheets) {
    await syncSheetToAtproto(sheet, fileRef);
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

    // trunk レコードのみ抽出 (branch レコードを除外)
    const sheetNodeEntries = nodeRecords.filter(
      (r) =>
        prefixFromRkey(rkeyFromUri(r.uri)) === TRUNK_PREFIX &&
        rkeyFromUri((r.value as NodeRecord).sheet.uri) === sheetRkey,
    );
    const sheetEdgeEntries = edgeRecords.filter(
      (r) =>
        prefixFromRkey(rkeyFromUri(r.uri)) === TRUNK_PREFIX &&
        rkeyFromUri((r.value as EdgeRecord).sheet.uri) === sheetRkey,
    );

    // rkey から nodeId/edgeId を抽出 (trunk_ プレフィックスを除去)
    const sheetNodes = sheetNodeEntries.map((r) =>
      recordToNode(idFromRkey(rkeyFromUri(r.uri)), r.value as NodeRecord),
    );
    const sheetEdges = sheetEdgeEntries.map((r) =>
      recordToEdge(idFromRkey(rkeyFromUri(r.uri)), r.value as EdgeRecord),
    );

    // nodeLayout: trunk prefix + nodeId で照合
    const sheetNodeUriSet = new Set(sheetNodeEntries.map((r) => r.uri));
    const sheetLayouts = nodeLayoutRecords
      .filter(
        (r) =>
          prefixFromRkey(rkeyFromUri(r.uri)) === TRUNK_PREFIX &&
          sheetNodeUriSet.has((r.value as NodeLayoutRecord).node.uri),
      )
      .map((r) =>
        recordToNodeLayout(
          idFromRkey(rkeyFromUri(r.uri)),
          r.value as NodeLayoutRecord,
        ),
      );

    // edgeLayout: trunk prefix + edgeId で照合
    const sheetEdgeUriSet = new Set(sheetEdgeEntries.map((r) => r.uri));
    const sheetEdgeLayouts = edgeLayoutRecords
      .filter(
        (r) =>
          prefixFromRkey(rkeyFromUri(r.uri)) === TRUNK_PREFIX &&
          sheetEdgeUriSet.has((r.value as EdgeLayoutRecord).edge.uri),
      )
      .map((r) =>
        recordToEdgeLayout(
          idFromRkey(rkeyFromUri(r.uri)),
          r.value as EdgeLayoutRecord,
        ),
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

/** ATProto の file レコード一覧を取得して GraphFileListItem[] として返す */
export async function fetchFilesFromAtproto(): Promise<GraphFileListItem[]> {
  const fileRecords = await files.list();
  return fileRecords.map((entry) =>
    recordToFileMeta(rkeyFromUri(entry.uri), entry.value as FileRecord),
  );
}

/**
 * ATProto から特定ファイルを取得して GraphFile として返す
 * シートは sheet.file 参照で照合する (file 参照がないシートは対象外)
 */
export async function fetchFileFromAtproto(fileId: string): Promise<GraphFile> {
  const [
    fileEntry,
    sheetRecords,
    nodeRecords,
    edgeRecords,
    nodeLayoutRecords,
    edgeLayoutRecords,
  ] = await Promise.all([
    files.get(fileId),
    sheets.list(),
    nodes.list(),
    edges.list(),
    nodeLayouts.list(),
    edgeLayouts.list(),
  ]);

  const fileMeta = recordToFileMeta(fileId, fileEntry.value as FileRecord);

  // このファイルに属するシートだけ抽出 (sheet.file の rkey = fileId)
  const fileSheets = sheetRecords.filter((entry) => {
    const rec = entry.value as SheetRecord;
    return rec.file !== undefined && rkeyFromUri(rec.file.uri) === fileId;
  });

  const sheetList: Sheet[] = fileSheets.map((sheetEntry) => {
    const sheetRkey = rkeyFromUri(sheetEntry.uri);
    const sheetRecord = sheetEntry.value as SheetRecord;
    const sheetMeta = recordToSheetMeta(sheetRkey, sheetRecord);

    // trunk レコードのみ抽出 (branch レコードを除外)
    const sheetNodeEntries = nodeRecords.filter(
      (r) =>
        prefixFromRkey(rkeyFromUri(r.uri)) === TRUNK_PREFIX &&
        rkeyFromUri((r.value as NodeRecord).sheet.uri) === sheetRkey,
    );
    const sheetEdgeEntries = edgeRecords.filter(
      (r) =>
        prefixFromRkey(rkeyFromUri(r.uri)) === TRUNK_PREFIX &&
        rkeyFromUri((r.value as EdgeRecord).sheet.uri) === sheetRkey,
    );

    const sheetNodes = sheetNodeEntries.map((r) =>
      recordToNode(idFromRkey(rkeyFromUri(r.uri)), r.value as NodeRecord),
    );
    const sheetEdges = sheetEdgeEntries.map((r) =>
      recordToEdge(idFromRkey(rkeyFromUri(r.uri)), r.value as EdgeRecord),
    );

    const sheetNodeUriSet = new Set(sheetNodeEntries.map((r) => r.uri));
    const sheetLayouts = nodeLayoutRecords
      .filter(
        (r) =>
          prefixFromRkey(rkeyFromUri(r.uri)) === TRUNK_PREFIX &&
          sheetNodeUriSet.has((r.value as NodeLayoutRecord).node.uri),
      )
      .map((r) =>
        recordToNodeLayout(
          idFromRkey(rkeyFromUri(r.uri)),
          r.value as NodeLayoutRecord,
        ),
      );

    const sheetEdgeUriSet = new Set(sheetEdgeEntries.map((r) => r.uri));
    const sheetEdgeLayouts = edgeLayoutRecords
      .filter(
        (r) =>
          prefixFromRkey(rkeyFromUri(r.uri)) === TRUNK_PREFIX &&
          sheetEdgeUriSet.has((r.value as EdgeLayoutRecord).edge.uri),
      )
      .map((r) =>
        recordToEdgeLayout(
          idFromRkey(rkeyFromUri(r.uri)),
          r.value as EdgeLayoutRecord,
        ),
      );

    return {
      ...sheetMeta,
      nodes: sheetNodes,
      edges: sheetEdges,
      layouts: sheetLayouts.length > 0 ? sheetLayouts : undefined,
      edgeLayouts: sheetEdgeLayouts.length > 0 ? sheetEdgeLayouts : undefined,
    };
  });

  return { ...fileMeta, sheets: sheetList };
}
