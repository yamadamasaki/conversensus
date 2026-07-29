/**
 * GraphFile / Sheet → ATProto PDS の legacy snapshot 書込オーケストレーター
 *
 * **Phase 6 p6-4 で読取側 (`fetchFilesFromAtproto` / `fetchFileFromAtproto` /
 * `fetchSheetsFromAtproto`) は撤去した** — PDS legacy レコードを読む経路は無くなり、
 * リモートからの取り込みは op-log (batch コレクション) だけになった (設計 §3.8)。
 * 残る書込側の唯一の呼び出し元は旧 branch 経路 (`BRANCH_FROM_OPLOG=false`) であり、
 * その安全弁を落とす p6-5 でこのファイルごと退役する (設計 §3.7)。
 *
 * 書き込み順序 (strongRef の依存関係に従う):
 *   1. sheet レコード       → sheetRef 取得
 *   2. node レコード (並列) → nodeRefs マップ構築
 *   3. edge レコード (並列、sourceRef/targetRef が必要)
 *   4. nodeLayout (並列、nodeRef + parentRef が必要)
 *   5. edgeLayout (並列、edgeRef が必要)
 */

import type { GraphFile, Sheet } from '@conversensus/shared';
import { cacheResult, getCreatedAt } from './cidCache';
import {
  edgeLayouts,
  edges,
  files,
  makeRkey,
  nodeLayouts,
  nodes,
  sheets,
  TRUNK_PREFIX,
} from './collections';
import {
  edgeLayoutToRecord,
  edgeToRecord,
  fileToRecord,
  nodeLayoutToRecord,
  nodeToRecord,
  sheetToRecord,
} from './mapper';
import type { StrongRef } from './types';
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
        nodeToRecord(node, sheetRef, undefined, nodeCreatedAt),
      );
      cacheResult(result.uri, result.cid, nodeCreatedAt);
      nodeRefs.set(node.id, { uri: result.uri, cid: result.cid });
    }),
  );

  // 2.5 parentId → parentRef を解決して再書き込み (全 node の ref が揃ってから)
  await Promise.all(
    sheet.nodes.map(async (node) => {
      if (!node.parentId) return;
      const parentRef = nodeRefs.get(node.parentId);
      if (!parentRef) return;
      const rkey = makeRkey(TRUNK_PREFIX, node.id);
      const nodeCreatedAt = getCreatedAt(NSID.node, rkey) ?? now;
      const result = await nodes.put(
        rkey,
        nodeToRecord(node, sheetRef, parentRef, nodeCreatedAt),
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
