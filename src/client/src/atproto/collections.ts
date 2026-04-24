import { currentDid, getAgent } from './client';
import {
  type BranchRecord,
  type CommitRecord,
  type EdgeLayoutRecord,
  type EdgeRecord,
  type FileRecord,
  type MergeRecord,
  type NodeLayoutRecord,
  type NodeRecord,
  NSID,
  type RecordResult,
  type SheetRecord,
  type StrongRef,
} from './types';

// --- rkey ヘルパー ---
// trunk node/edge の rkey: "trunk_{uuid}"
// branch node/edge の rkey: "{branchId}_{uuid}"

export const TRUNK_PREFIX = 'trunk';

export function makeRkey(prefix: string, id: string): string {
  return `${prefix}_${id}`;
}

// "trunk_uuid" → "uuid"、旧形式 "uuid" (プレフィックスなし) → "uuid" (後方互換)
export function idFromRkey(rkey: string): string {
  const idx = rkey.indexOf('_');
  return idx >= 0 ? rkey.slice(idx + 1) : rkey;
}

// "trunk_uuid" → "trunk"、旧形式 "uuid" → TRUNK_PREFIX (後方互換)
export function prefixFromRkey(rkey: string): string {
  const idx = rkey.indexOf('_');
  return idx >= 0 ? rkey.slice(0, idx) : TRUNK_PREFIX;
}

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
  return { ...res.data, cid: res.data.cid ?? '' };
}

async function listRecords(
  collection: string,
): Promise<Array<{ uri: string; cid: string; value: unknown }>> {
  const all: Array<{ uri: string; cid: string; value: unknown }> = [];
  let cursor: string | undefined;
  do {
    const res = await getAgent().api.com.atproto.repo.listRecords({
      repo: currentDid(),
      collection,
      limit: 100,
      cursor,
    });
    all.push(...res.data.records);
    cursor = res.data.cursor;
  } while (cursor);
  return all;
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

// --- File ---

export const files = {
  put(fileId: string, data: Omit<FileRecord, '$type'>): Promise<RecordResult> {
    return putRecord(NSID.file, fileId, { $type: NSID.file, ...data });
  },
  get(fileId: string) {
    return getRecord(NSID.file, fileId);
  },
  list() {
    return listRecords(NSID.file);
  },
  delete(fileId: string) {
    return deleteRecord(NSID.file, fileId);
  },
  async ref(fileId: string): Promise<StrongRef> {
    const r = await getRecord(NSID.file, fileId);
    return { uri: r.uri, cid: r.cid };
  },
};

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
  put(rkey: string, data: Omit<NodeRecord, '$type'>): Promise<RecordResult> {
    return putRecord(NSID.node, rkey, { $type: NSID.node, ...data });
  },
  get(rkey: string) {
    return getRecord(NSID.node, rkey);
  },
  list() {
    return listRecords(NSID.node);
  },
  async listForPrefix(prefix: string) {
    const all = await listRecords(NSID.node);
    return all.filter((r) => prefixFromRkey(rkeyFromUri(r.uri)) === prefix);
  },
  delete(rkey: string) {
    return deleteRecord(NSID.node, rkey);
  },
  async ref(rkey: string): Promise<StrongRef> {
    const r = await getRecord(NSID.node, rkey);
    return { uri: r.uri, cid: r.cid };
  },
  refFromResult(_rkey: string, result: RecordResult): StrongRef {
    return { uri: result.uri, cid: result.cid };
  },
};

// --- Edge ---

export const edges = {
  put(rkey: string, data: Omit<EdgeRecord, '$type'>): Promise<RecordResult> {
    return putRecord(NSID.edge, rkey, { $type: NSID.edge, ...data });
  },
  get(rkey: string) {
    return getRecord(NSID.edge, rkey);
  },
  list() {
    return listRecords(NSID.edge);
  },
  async listForPrefix(prefix: string) {
    const all = await listRecords(NSID.edge);
    return all.filter((r) => prefixFromRkey(rkeyFromUri(r.uri)) === prefix);
  },
  delete(rkey: string) {
    return deleteRecord(NSID.edge, rkey);
  },
};

// --- NodeLayout ---

export const nodeLayouts = {
  put(
    rkey: string,
    data: Omit<NodeLayoutRecord, '$type'>,
  ): Promise<RecordResult> {
    return putRecord(NSID.nodeLayout, rkey, {
      $type: NSID.nodeLayout,
      ...data,
    });
  },
  get(rkey: string) {
    return getRecord(NSID.nodeLayout, rkey);
  },
  list() {
    return listRecords(NSID.nodeLayout);
  },
  async listForPrefix(prefix: string) {
    const all = await listRecords(NSID.nodeLayout);
    return all.filter((r) => prefixFromRkey(rkeyFromUri(r.uri)) === prefix);
  },
  delete(rkey: string) {
    return deleteRecord(NSID.nodeLayout, rkey);
  },
};

// --- EdgeLayout ---

export const edgeLayouts = {
  put(
    rkey: string,
    data: Omit<EdgeLayoutRecord, '$type'>,
  ): Promise<RecordResult> {
    return putRecord(NSID.edgeLayout, rkey, {
      $type: NSID.edgeLayout,
      ...data,
    });
  },
  get(rkey: string) {
    return getRecord(NSID.edgeLayout, rkey);
  },
  list() {
    return listRecords(NSID.edgeLayout);
  },
  async listForPrefix(prefix: string) {
    const all = await listRecords(NSID.edgeLayout);
    return all.filter((r) => prefixFromRkey(rkeyFromUri(r.uri)) === prefix);
  },
  delete(rkey: string) {
    return deleteRecord(NSID.edgeLayout, rkey);
  },
};

// --- Branch ---

export const branches = {
  put(
    branchId: string,
    data: Omit<BranchRecord, '$type'>,
  ): Promise<RecordResult> {
    return putRecord(NSID.branch, branchId, { $type: NSID.branch, ...data });
  },
  get(branchId: string) {
    return getRecord(NSID.branch, branchId);
  },
  list() {
    return listRecords(NSID.branch);
  },
  delete(branchId: string) {
    return deleteRecord(NSID.branch, branchId);
  },
  async ref(branchId: string): Promise<StrongRef> {
    const r = await getRecord(NSID.branch, branchId);
    return { uri: r.uri, cid: r.cid };
  },
};

// --- Commit ---

export const commits = {
  put(
    commitId: string,
    data: Omit<CommitRecord, '$type'>,
  ): Promise<RecordResult> {
    return putRecord(NSID.commit, commitId, { $type: NSID.commit, ...data });
  },
  get(commitId: string) {
    return getRecord(NSID.commit, commitId);
  },
  list() {
    return listRecords(NSID.commit);
  },
  delete(commitId: string) {
    return deleteRecord(NSID.commit, commitId);
  },
};

// --- Merge ---

export const merges = {
  put(
    mergeId: string,
    data: Omit<MergeRecord, '$type'>,
  ): Promise<RecordResult> {
    return putRecord(NSID.merge, mergeId, { $type: NSID.merge, ...data });
  },
  list() {
    return listRecords(NSID.merge);
  },
  delete(mergeId: string) {
    return deleteRecord(NSID.merge, mergeId);
  },
};

export { atUri, rkeyFromUri };
