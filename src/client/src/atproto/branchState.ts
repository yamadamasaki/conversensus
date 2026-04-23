/**
 * Branch / Commit のドメイン型とロジック
 *
 * - Branch: sheet の子として存在する仮想的なバージョン
 * - Commit: 意図的な変更のバッチ (message + operations)
 * - computeOperations: base sheet と current sheet の差分を CommitOperation[] として計算
 * - applyOperations: base sheet に CommitOperation[] を適用して branch の状態を再構築
 */

import type {
  CommitOperation,
  GraphEdge,
  GraphNode,
  Sheet,
  SheetId,
} from '@conversensus/shared';
import { currentDid } from './client';
import { branches, commits, merges, rkeyFromUri } from './collections';
import type { BranchRecord, CommitRecord, StrongRef } from './types';

// --- Domain types ---

export type Branch = {
  id: string; // UUID (rkey)
  sheetId: SheetId;
  name: string;
  description?: string;
  authorDid: string;
  status: 'open' | 'merged' | 'closed';
  baseCommitUri?: string;
  createdAt: string;
  // ATProto reference
  uri: string;
  cid: string;
};

export type Commit = {
  id: string; // UUID (rkey)
  sheetId: SheetId;
  branchUri: string;
  message: string;
  authorDid: string;
  parentCommitUri?: string;
  operations: CommitOperation[];
  createdAt: string;
  // ATProto reference
  uri: string;
  cid: string;
};

// --- Diff: base → current を CommitOperation[] として計算 ---
// layout 変更は含めない (滑らかな変更は commit 対象外)

export function computeOperations(
  base: Sheet,
  current: Sheet,
): CommitOperation[] {
  const ops: CommitOperation[] = [];

  const baseNodeMap = new Map(base.nodes.map((n) => [n.id, n]));
  const currentNodeMap = new Map(current.nodes.map((n) => [n.id, n]));
  const baseEdgeMap = new Map(base.edges.map((e) => [e.id, e]));
  const currentEdgeMap = new Map(current.edges.map((e) => [e.id, e]));

  // 追加されたノード
  for (const node of current.nodes) {
    if (!baseNodeMap.has(node.id)) {
      ops.push({
        op: 'node.add',
        nodeId: node.id,
        content: node.content,
        ...(node.properties && { properties: node.properties }),
      });
    }
  }

  // 変更されたノード
  for (const node of current.nodes) {
    const baseNode = baseNodeMap.get(node.id);
    if (
      baseNode &&
      (baseNode.content !== node.content ||
        JSON.stringify(baseNode.properties) !== JSON.stringify(node.properties))
    ) {
      ops.push({
        op: 'node.update',
        nodeId: node.id,
        content: node.content,
        ...(node.properties && { properties: node.properties }),
      });
    }
  }

  // 削除されたノード
  for (const node of base.nodes) {
    if (!currentNodeMap.has(node.id)) {
      ops.push({ op: 'node.remove', nodeId: node.id });
    }
  }

  // 追加されたエッジ
  for (const edge of current.edges) {
    if (!baseEdgeMap.has(edge.id)) {
      ops.push({
        op: 'edge.add',
        edgeId: edge.id,
        sourceId: edge.source,
        targetId: edge.target,
        ...(edge.label && { label: edge.label }),
        ...(edge.properties && { properties: edge.properties }),
      });
    }
  }

  // 変更されたエッジ
  for (const edge of current.edges) {
    const baseEdge = baseEdgeMap.get(edge.id);
    if (
      baseEdge &&
      (baseEdge.label !== edge.label ||
        JSON.stringify(baseEdge.properties) !== JSON.stringify(edge.properties))
    ) {
      ops.push({
        op: 'edge.update',
        edgeId: edge.id,
        ...(edge.label !== undefined && { label: edge.label }),
        ...(edge.properties && { properties: edge.properties }),
      });
    }
  }

  // 削除されたエッジ
  for (const edge of base.edges) {
    if (!currentEdgeMap.has(edge.id)) {
      ops.push({ op: 'edge.remove', edgeId: edge.id });
    }
  }

  return ops;
}

// --- Apply: base sheet に operations を適用して branch state を再構築 ---

export function applyOperations(
  base: Sheet,
  operations: CommitOperation[],
): Sheet {
  let nodes = [...base.nodes];
  let edges = [...base.edges];

  for (const op of operations) {
    switch (op.op) {
      case 'node.add':
        if (!nodes.find((n) => n.id === op.nodeId)) {
          nodes.push({
            id: op.nodeId as GraphNode['id'],
            content: op.content,
            ...(op.properties && { properties: op.properties }),
          });
        }
        break;
      case 'node.update':
        nodes = nodes.map((n) =>
          n.id === op.nodeId
            ? {
                ...n,
                ...(op.content !== undefined && { content: op.content }),
                ...(op.properties !== undefined && {
                  properties: op.properties,
                }),
              }
            : n,
        );
        break;
      case 'node.remove':
        nodes = nodes.filter((n) => n.id !== op.nodeId);
        edges = edges.filter(
          (e) => e.source !== op.nodeId && e.target !== op.nodeId,
        );
        break;
      case 'edge.add':
        if (!edges.find((e) => e.id === op.edgeId)) {
          edges.push({
            id: op.edgeId as GraphEdge['id'],
            source: op.sourceId as GraphNode['id'],
            target: op.targetId as GraphNode['id'],
            ...(op.label && { label: op.label }),
            ...(op.properties && { properties: op.properties }),
          });
        }
        break;
      case 'edge.update':
        edges = edges.map((e) =>
          e.id === op.edgeId
            ? {
                ...e,
                ...(op.label !== undefined && { label: op.label }),
                ...(op.properties !== undefined && {
                  properties: op.properties,
                }),
              }
            : e,
        );
        break;
      case 'edge.remove':
        edges = edges.filter((e) => e.id !== op.edgeId);
        break;
    }
  }

  return { ...base, nodes, edges };
}

// --- ATProto helpers ---

/** sheet に紐づく全 branch を取得 */
export async function fetchBranchesForSheet(
  sheetId: SheetId,
): Promise<Branch[]> {
  const all = await branches.list();
  return all
    .filter((r) => {
      const rec = r.value as BranchRecord;
      return rkeyFromUri(rec.sheet.uri) === sheetId;
    })
    .map((r) => {
      const rec = r.value as BranchRecord;
      return {
        id: rkeyFromUri(r.uri),
        sheetId,
        name: rec.name,
        description: rec.description,
        authorDid: rec.authorDid,
        status: rec.status,
        baseCommitUri: rec.baseCommit?.uri,
        createdAt: rec.createdAt,
        uri: r.uri,
        cid: r.cid,
      };
    });
}

/** branch に紐づく全 commit を parentCommit チェーンの順に返す */
export async function fetchCommitsForBranch(
  branchUri: string,
): Promise<Commit[]> {
  const all = await commits.list();
  const forBranch = all
    .filter((r) => {
      const rec = r.value as CommitRecord;
      return rec.branch.uri === branchUri;
    })
    .map((r) => {
      const rec = r.value as CommitRecord;
      return {
        id: rkeyFromUri(r.uri),
        sheetId: rkeyFromUri(rec.sheet.uri) as SheetId,
        branchUri: rec.branch.uri,
        message: rec.message,
        authorDid: rec.authorDid,
        parentCommitUri: rec.parentCommit?.uri,
        operations: rec.operations as CommitOperation[],
        createdAt: rec.createdAt,
        uri: r.uri,
        cid: r.cid,
      };
    });

  // parentCommit チェーンでトポロジカルソート
  return sortCommitChain(forBranch);
}

function sortCommitChain(commitList: Commit[]): Commit[] {
  const result: Commit[] = [];
  // root から順に並べる
  let current = commitList.find((c) => !c.parentCommitUri);
  while (current) {
    result.push(current);
    const next = commitList.find((c) => c.parentCommitUri === current?.uri);
    current = next;
  }
  // チェーンに含まれなかったものは末尾に追加
  for (const c of commitList) {
    if (!result.find((r) => r.uri === c.uri)) result.push(c);
  }
  return result;
}

/** main branch を作成 (sheet 作成時に呼ぶ) */
export async function createMainBranch(
  sheetId: SheetId,
  sheetRef: StrongRef,
): Promise<Branch> {
  const branchId = crypto.randomUUID();
  const now = new Date().toISOString();
  const authorDid = currentDid();
  const result = await branches.put(branchId, {
    sheet: sheetRef,
    name: 'main',
    authorDid,
    status: 'open',
    createdAt: now,
  });
  return {
    id: branchId,
    sheetId,
    name: 'main',
    authorDid,
    status: 'open',
    createdAt: now,
    uri: result.uri,
    cid: result.cid,
  };
}

/** feature branch を作成 */
export async function createBranch(
  name: string,
  sheetId: SheetId,
  sheetRef: StrongRef,
  baseCommitRef?: StrongRef,
): Promise<Branch> {
  const branchId = crypto.randomUUID();
  const now = new Date().toISOString();
  const authorDid = currentDid();
  const result = await branches.put(branchId, {
    sheet: sheetRef,
    name,
    authorDid,
    status: 'open',
    ...(baseCommitRef && { baseCommit: baseCommitRef }),
    createdAt: now,
  });
  return {
    id: branchId,
    sheetId,
    name,
    authorDid,
    status: 'open',
    baseCommitUri: baseCommitRef?.uri,
    createdAt: now,
    uri: result.uri,
    cid: result.cid,
  };
}

/** branch の status を更新して PDS に保存 */
export async function updateBranchStatus(
  branch: Branch,
  status: 'open' | 'merged' | 'closed',
): Promise<Branch> {
  const current = await branches.get(branch.id);
  const { $type: _, ...rest } = current.value as BranchRecord;
  const result = await branches.put(branch.id, { ...rest, status });
  return { ...branch, status, cid: result.cid };
}

/** merge レコードを作成して PDS に保存 */
export async function createMergeRecord(
  branch: Branch,
  sheetRef: StrongRef,
  branchRef: StrongRef,
  latestCommitRef?: StrongRef,
): Promise<void> {
  const mergeId = crypto.randomUUID();
  await merges.put(mergeId, {
    sheet: sheetRef,
    branch: branchRef,
    message: `Merge branch '${branch.name}'`,
    authorDid: currentDid(),
    ...(latestCommitRef && { commit: latestCommitRef }),
    createdAt: new Date().toISOString(),
  });
}

/** branch とその全 commit を PDS から削除 */
export async function deleteBranchFromPds(branch: Branch): Promise<void> {
  const branchCommits = await fetchCommitsForBranch(branch.uri);
  await Promise.all(branchCommits.map((c) => commits.delete(c.id)));
  await branches.delete(branch.id);
}

/** commit を作成して ATProto に保存 */
export async function createCommit(
  message: string,
  operations: CommitOperation[],
  sheetRef: StrongRef,
  branchRef: StrongRef,
  parentCommitRef?: StrongRef,
): Promise<Commit> {
  const commitId = crypto.randomUUID();
  const now = new Date().toISOString();
  const authorDid = currentDid();
  const result = await commits.put(commitId, {
    sheet: sheetRef,
    branch: branchRef,
    message,
    authorDid,
    ...(parentCommitRef && { parentCommit: parentCommitRef }),
    operations: operations as unknown[],
    createdAt: now,
  });
  return {
    id: commitId,
    sheetId: rkeyFromUri(sheetRef.uri) as SheetId,
    branchUri: branchRef.uri,
    message,
    authorDid,
    parentCommitUri: parentCommitRef?.uri,
    operations,
    createdAt: now,
    uri: result.uri,
    cid: result.cid,
  };
}
