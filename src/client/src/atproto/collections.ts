import { currentDid, getAgent } from './client';
import {
  type EdgeLayoutRecord,
  type EdgeRecord,
  type NodeLayoutRecord,
  type NodeRecord,
  NSID,
  type RecordResult,
  type SheetRecord,
  type StrongRef,
} from './types';

// --- 汎用ヘルパー ---

async function putRecord(
  collection: string,
  rkey: string,
  record: Record<string, unknown>,
): Promise<RecordResult> {
  const res = await getAgent().api.com.atproto.repo.putRecord({
    repo: currentDid(),
    collection,
    rkey,
    record,
  });
  return res.data;
}

async function getRecord(
  collection: string,
  rkey: string,
): Promise<{ uri: string; cid: string; value: unknown }> {
  const res = await getAgent().api.com.atproto.repo.getRecord({
    repo: currentDid(),
    collection,
    rkey,
  });
  return res.data;
}

async function listRecords(
  collection: string,
): Promise<Array<{ uri: string; cid: string; value: unknown }>> {
  const res = await getAgent().api.com.atproto.repo.listRecords({
    repo: currentDid(),
    collection,
  });
  return res.data.records;
}

async function deleteRecord(collection: string, rkey: string): Promise<void> {
  await getAgent().api.com.atproto.repo.deleteRecord({
    repo: currentDid(),
    collection,
    rkey,
  });
}

// rkey を AT-URI から取り出す: "at://did/collection/rkey" → "rkey"
function rkeyFromUri(uri: string): string {
  return uri.split('/').at(-1) ?? uri;
}

// AT-URI を構築する
function atUri(collection: string, rkey: string): string {
  return `at://${currentDid()}/${collection}/${rkey}`;
}

// --- Sheet ---

export const sheets = {
  put(
    sheetId: string,
    data: Omit<SheetRecord, '$type'>,
  ): Promise<RecordResult> {
    return putRecord(NSID.sheet, sheetId, { $type: NSID.sheet, ...data });
  },
  get(sheetId: string) {
    return getRecord(NSID.sheet, sheetId);
  },
  list() {
    return listRecords(NSID.sheet);
  },
  delete(sheetId: string) {
    return deleteRecord(NSID.sheet, sheetId);
  },
  // sheetId から StrongRef を構築 (get して CID を取得)
  async ref(sheetId: string): Promise<StrongRef> {
    const r = await getRecord(NSID.sheet, sheetId);
    return { uri: r.uri, cid: r.cid };
  },
};

// --- Node ---

export const nodes = {
  put(nodeId: string, data: Omit<NodeRecord, '$type'>): Promise<RecordResult> {
    return putRecord(NSID.node, nodeId, { $type: NSID.node, ...data });
  },
  get(nodeId: string) {
    return getRecord(NSID.node, nodeId);
  },
  list() {
    return listRecords(NSID.node);
  },
  delete(nodeId: string) {
    return deleteRecord(NSID.node, nodeId);
  },
  async ref(nodeId: string): Promise<StrongRef> {
    const r = await getRecord(NSID.node, nodeId);
    return { uri: r.uri, cid: r.cid };
  },
  // put 結果から直接 StrongRef を作る (追加のネットワークラウンドトリップなし)
  refFromResult(_nodeId: string, result: RecordResult): StrongRef {
    return { uri: result.uri, cid: result.cid };
  },
};

// --- Edge ---

export const edges = {
  put(edgeId: string, data: Omit<EdgeRecord, '$type'>): Promise<RecordResult> {
    return putRecord(NSID.edge, edgeId, { $type: NSID.edge, ...data });
  },
  get(edgeId: string) {
    return getRecord(NSID.edge, edgeId);
  },
  list() {
    return listRecords(NSID.edge);
  },
  delete(edgeId: string) {
    return deleteRecord(NSID.edge, edgeId);
  },
};

// --- NodeLayout ---

export const nodeLayouts = {
  put(
    nodeId: string,
    data: Omit<NodeLayoutRecord, '$type'>,
  ): Promise<RecordResult> {
    // rkey = nodeId: 1ノードにつき最新レイアウト1件
    return putRecord(NSID.nodeLayout, nodeId, {
      $type: NSID.nodeLayout,
      ...data,
    });
  },
  get(nodeId: string) {
    return getRecord(NSID.nodeLayout, nodeId);
  },
  list() {
    return listRecords(NSID.nodeLayout);
  },
  delete(nodeId: string) {
    return deleteRecord(NSID.nodeLayout, nodeId);
  },
};

// --- EdgeLayout ---

export const edgeLayouts = {
  put(
    edgeId: string,
    data: Omit<EdgeLayoutRecord, '$type'>,
  ): Promise<RecordResult> {
    // rkey = edgeId: 1エッジにつき最新レイアウト1件
    return putRecord(NSID.edgeLayout, edgeId, {
      $type: NSID.edgeLayout,
      ...data,
    });
  },
  get(edgeId: string) {
    return getRecord(NSID.edgeLayout, edgeId);
  },
  list() {
    return listRecords(NSID.edgeLayout);
  },
  delete(edgeId: string) {
    return deleteRecord(NSID.edgeLayout, edgeId);
  },
};

export { atUri, rkeyFromUri };
