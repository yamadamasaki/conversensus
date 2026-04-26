/**
 * Branch / Commit のドメイン型とロジック
 *
 * - Branch: sheet の子として存在するバージョン (trunk も含む)
 * - Commit: author の意図の表現 (semantic checkpoint)
 *   storage への書き込みタイミング (即時 auto-save) とは独立
 * - computeOperations: 2 つの Sheet の差分を CommitOperation[] として計算
 *   (CommitRecord.operations の生成と UI の diff 表示に使用)
 *
 * Node/Edge レコードの rkey 方式:
 *   trunk: "trunk_{uuid}"
 *   branch: "{branchId}_{uuid}"
 */

import type {
  CommitOperation,
  EdgeLayout,
  GraphEdge,
  GraphNode,
  NodeLayout,
  Sheet,
  SheetId,
} from '@conversensus/shared';
import { currentDid } from './client';
import {
  branches,
  commits,
  edgeLayouts,
  edges,
  idFromRkey,
  makeRkey,
  merges,
  nodeLayouts,
  nodes,
  rkeyFromUri,
  sheets,
  TRUNK_PREFIX,
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
} from './mapper';
import type {
  BranchRecord,
  CommitRecord,
  EdgeLayoutRecord,
  EdgeRecord,
  NodeLayoutRecord,
  NodeRecord,
  SheetRecord,
  StrongRef,
} from './types';

// --- Domain types ---

export type Branch = {
  id: string; // UUID (rkey)
  sheetId: SheetId;
  name: string;
  description?: string;
  authorDid: string;
  status: 'creating' | 'open' | 'merged' | 'closed';
  baseCommitUri?: string;
  createdAt: string;
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

  for (const node of base.nodes) {
    if (!currentNodeMap.has(node.id)) {
      ops.push({ op: 'node.remove', nodeId: node.id });
    }
  }

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

  for (const edge of base.edges) {
    if (!currentEdgeMap.has(edge.id)) {
      ops.push({ op: 'edge.remove', edgeId: edge.id });
    }
  }

  return ops;
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

  return sortCommitChain(forBranch);
}

function sortCommitChain(commitList: Commit[]): Commit[] {
  const result: Commit[] = [];
  let current = commitList.find((c) => !c.parentCommitUri);
  while (current) {
    result.push(current);
    const next = commitList.find((c) => c.parentCommitUri === current?.uri);
    current = next;
  }
  for (const c of commitList) {
    if (!result.find((r) => r.uri === c.uri)) result.push(c);
  }
  return result;
}

/** trunk branch を作成 (sheet 作成時に呼ぶ) */
export async function createMainBranch(
  sheetId: SheetId,
  sheetRef: StrongRef,
): Promise<Branch> {
  const branchId = crypto.randomUUID();
  const now = new Date().toISOString();
  const authorDid = currentDid();
  const result = await branches.put(branchId, {
    sheet: sheetRef,
    name: 'trunk',
    authorDid,
    status: 'open',
    createdAt: now,
  });
  return {
    id: branchId,
    sheetId,
    name: 'trunk',
    authorDid,
    status: 'open',
    createdAt: now,
    uri: result.uri,
    cid: result.cid,
  };
}

// --- 内部ヘルパー: trunk の node/edge/layout データを取得 ---

type TrunkSheetData = {
  nodes: Array<{ node: GraphNode; ref: StrongRef }>;
  edges: Array<{ edge: GraphEdge; sourceRef: StrongRef; targetRef: StrongRef }>;
  nodeLayouts: Array<{
    layout: NodeLayout;
    nodeRef: StrongRef;
    parentRef?: StrongRef;
  }>;
  edgeLayouts: Array<{ layout: EdgeLayout; edgeRef: StrongRef }>;
};

async function fetchTrunkSheetData(sheetId: SheetId): Promise<TrunkSheetData> {
  const [allNodes, allEdges, allNodeLayouts, allEdgeLayouts] =
    await Promise.all([
      nodes.listForPrefix(TRUNK_PREFIX),
      edges.listForPrefix(TRUNK_PREFIX),
      nodeLayouts.listForPrefix(TRUNK_PREFIX),
      edgeLayouts.listForPrefix(TRUNK_PREFIX),
    ]);

  const sheetNodes = allNodes.filter(
    (r) => rkeyFromUri((r.value as NodeRecord).sheet.uri) === sheetId,
  );
  const sheetEdges = allEdges.filter(
    (r) => rkeyFromUri((r.value as EdgeRecord).sheet.uri) === sheetId,
  );

  const nodeUriToId = new Map(
    sheetNodes.map((r) => [r.uri, idFromRkey(rkeyFromUri(r.uri))]),
  );
  const nodeIdToRef = new Map(
    sheetNodes.map((r) => [
      idFromRkey(rkeyFromUri(r.uri)),
      { uri: r.uri, cid: r.cid },
    ]),
  );
  const edgeIdToRef = new Map(
    sheetEdges.map((r) => [
      idFromRkey(rkeyFromUri(r.uri)),
      { uri: r.uri, cid: r.cid },
    ]),
  );
  const sheetNodeUriSet = new Set(sheetNodes.map((r) => r.uri));
  const sheetEdgeUriSet = new Set(sheetEdges.map((r) => r.uri));

  const nodesResult = sheetNodes.map((r) => ({
    node: recordToNode(idFromRkey(rkeyFromUri(r.uri)), r.value as NodeRecord),
    ref: { uri: r.uri, cid: r.cid } as StrongRef,
  }));

  const edgesResult = sheetEdges.map((r) => {
    const rec = r.value as EdgeRecord;
    return {
      edge: recordToEdge(idFromRkey(rkeyFromUri(r.uri)), rec),
      sourceRef:
        nodeIdToRef.get(idFromRkey(rkeyFromUri(rec.source.uri))) ?? rec.source,
      targetRef:
        nodeIdToRef.get(idFromRkey(rkeyFromUri(rec.target.uri))) ?? rec.target,
    };
  });

  const nodeLayoutsResult = allNodeLayouts
    .filter((r) => sheetNodeUriSet.has((r.value as NodeLayoutRecord).node.uri))
    .map((r) => {
      const rec = r.value as NodeLayoutRecord;
      const nodeId =
        nodeUriToId.get(rec.node.uri) ?? idFromRkey(rkeyFromUri(rec.node.uri));
      const parentId = rec.parent
        ? (nodeUriToId.get(rec.parent.uri) ??
          idFromRkey(rkeyFromUri(rec.parent.uri)))
        : undefined;
      return {
        layout: recordToNodeLayout(nodeId, rec),
        nodeRef: nodeIdToRef.get(nodeId) ?? rec.node,
        parentRef: parentId
          ? (nodeIdToRef.get(parentId) ?? rec.parent)
          : undefined,
      };
    });

  const edgeLayoutsResult = allEdgeLayouts
    .filter((r) => sheetEdgeUriSet.has((r.value as EdgeLayoutRecord).edge.uri))
    .map((r) => {
      const rec = r.value as EdgeLayoutRecord;
      const edgeId = idFromRkey(rkeyFromUri(rec.edge.uri));
      return {
        layout: recordToEdgeLayout(edgeId, rec),
        edgeRef: edgeIdToRef.get(edgeId) ?? rec.edge,
      };
    });

  return {
    nodes: nodesResult,
    edges: edgesResult,
    nodeLayouts: nodeLayoutsResult,
    edgeLayouts: edgeLayoutsResult,
  };
}

/** feature branch を作成: trunk の node/edge/layout を 2-phase でコピー */
export async function createBranch(
  name: string,
  sheetId: SheetId,
  sheetRef: StrongRef,
  baseCommitRef?: StrongRef,
): Promise<Branch> {
  const branchId = crypto.randomUUID();
  const now = new Date().toISOString();
  const authorDid = currentDid();

  // Phase 1: BranchRecord を 'creating' で作成
  await branches.put(branchId, {
    sheet: sheetRef,
    name,
    authorDid,
    status: 'creating',
    ...(baseCommitRef && { baseCommit: baseCommitRef }),
    createdAt: now,
  });

  // Phase 2: trunk の records を branch prefix でコピー
  const trunkData = await fetchTrunkSheetData(sheetId);

  const nodeIdToBranchRef = new Map<string, StrongRef>();
  await Promise.all(
    trunkData.nodes.map(async ({ node }) => {
      const rkey = makeRkey(branchId, node.id);
      const result = await nodes.put(rkey, nodeToRecord(node, sheetRef, now));
      nodeIdToBranchRef.set(node.id, { uri: result.uri, cid: result.cid });
    }),
  );

  const edgeIdToBranchRef = new Map<string, StrongRef>();
  await Promise.all(
    trunkData.edges.map(async ({ edge }) => {
      const sourceRef = nodeIdToBranchRef.get(edge.source);
      const targetRef = nodeIdToBranchRef.get(edge.target);
      if (!sourceRef || !targetRef) return;
      const rkey = makeRkey(branchId, edge.id);
      const result = await edges.put(
        rkey,
        edgeToRecord(edge, sheetRef, sourceRef, targetRef, now),
      );
      edgeIdToBranchRef.set(edge.id, { uri: result.uri, cid: result.cid });
    }),
  );

  await Promise.all(
    trunkData.nodeLayouts.map(async ({ layout, nodeRef: _, parentRef: __ }) => {
      const nodeRef = nodeIdToBranchRef.get(layout.nodeId);
      if (!nodeRef) return;
      const parentRef = layout.parentId
        ? nodeIdToBranchRef.get(layout.parentId)
        : undefined;
      const rkey = makeRkey(branchId, layout.nodeId);
      await nodeLayouts.put(
        rkey,
        nodeLayoutToRecord(layout, nodeRef, parentRef, now),
      );
    }),
  );

  await Promise.all(
    trunkData.edgeLayouts.map(async ({ layout }) => {
      const edgeRef = edgeIdToBranchRef.get(layout.edgeId);
      if (!edgeRef) return;
      const rkey = makeRkey(branchId, layout.edgeId);
      await edgeLayouts.put(rkey, edgeLayoutToRecord(layout, edgeRef, now));
    }),
  );

  // Phase 3: BranchRecord を 'open' に更新
  const openResult = await branches.put(branchId, {
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
    uri: openResult.uri,
    cid: openResult.cid,
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

/** branch の sheet を PDS から読み込んで Sheet として返す */
export async function fetchBranchSheetFromPds(
  branchId: string,
  sheetId: SheetId,
): Promise<Sheet> {
  const [sheetEntry, allNodes, allEdges, allNodeLayouts, allEdgeLayouts] =
    await Promise.all([
      sheets.get(sheetId),
      nodes.listForPrefix(branchId),
      edges.listForPrefix(branchId),
      nodeLayouts.listForPrefix(branchId),
      edgeLayouts.listForPrefix(branchId),
    ]);

  const sheetNodeEntries = allNodes.filter(
    (r) => rkeyFromUri((r.value as NodeRecord).sheet.uri) === sheetId,
  );
  const sheetEdgeEntries = allEdges.filter(
    (r) => rkeyFromUri((r.value as EdgeRecord).sheet.uri) === sheetId,
  );

  const sheetNodes = sheetNodeEntries.map((r) =>
    recordToNode(idFromRkey(rkeyFromUri(r.uri)), r.value as NodeRecord),
  );
  const sheetEdges = sheetEdgeEntries.map((r) =>
    recordToEdge(idFromRkey(rkeyFromUri(r.uri)), r.value as EdgeRecord),
  );

  const branchNodeUriSet = new Set(sheetNodeEntries.map((r) => r.uri));
  const branchEdgeUriSet = new Set(sheetEdgeEntries.map((r) => r.uri));

  const sheetLayouts = allNodeLayouts
    .filter((r) => branchNodeUriSet.has((r.value as NodeLayoutRecord).node.uri))
    .map((r) =>
      recordToNodeLayout(
        idFromRkey(rkeyFromUri(r.uri)),
        r.value as NodeLayoutRecord,
      ),
    );

  const sheetEdgeLayouts = allEdgeLayouts
    .filter((r) => branchEdgeUriSet.has((r.value as EdgeLayoutRecord).edge.uri))
    .map((r) =>
      recordToEdgeLayout(
        idFromRkey(rkeyFromUri(r.uri)),
        r.value as EdgeLayoutRecord,
      ),
    );

  const rec = sheetEntry.value as SheetRecord;
  return {
    id: sheetId,
    name: rec.name,
    ...(rec.description && { description: rec.description }),
    nodes: sheetNodes,
    edges: sheetEdges,
    ...(sheetLayouts.length > 0 && { layouts: sheetLayouts }),
    ...(sheetEdgeLayouts.length > 0 && { edgeLayouts: sheetEdgeLayouts }),
  };
}

/** branch sheet を PDS に書き込む (auto-save 用) */
export async function syncBranchSheetToAtproto(
  sheet: Sheet,
  sheetRef: StrongRef,
  branchId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const sheetId = sheet.id;

  // nodes
  const nodeIdToRef = new Map<string, StrongRef>();
  await Promise.all(
    sheet.nodes.map(async (node) => {
      const rkey = makeRkey(branchId, node.id);
      const result = await nodes.put(rkey, nodeToRecord(node, sheetRef, now));
      nodeIdToRef.set(node.id, { uri: result.uri, cid: result.cid });
    }),
  );

  // edges
  const edgeIdToRef = new Map<string, StrongRef>();
  await Promise.all(
    sheet.edges.map(async (edge) => {
      const sourceRef = nodeIdToRef.get(edge.source);
      const targetRef = nodeIdToRef.get(edge.target);
      if (!sourceRef || !targetRef) {
        console.warn(
          `syncBranchSheetToAtproto: edge ${edge.id} source/target not found`,
        );
        return;
      }
      const rkey = makeRkey(branchId, edge.id);
      const result = await edges.put(
        rkey,
        edgeToRecord(edge, sheetRef, sourceRef, targetRef, now),
      );
      edgeIdToRef.set(edge.id, { uri: result.uri, cid: result.cid });
    }),
  );

  // nodeLayouts
  if (sheet.layouts && sheet.layouts.length > 0) {
    await Promise.all(
      sheet.layouts.map(async (layout) => {
        const nodeRef = nodeIdToRef.get(layout.nodeId);
        if (!nodeRef) return;
        const parentRef = layout.parentId
          ? nodeIdToRef.get(layout.parentId)
          : undefined;
        const rkey = makeRkey(branchId, layout.nodeId);
        await nodeLayouts.put(
          rkey,
          nodeLayoutToRecord(layout, nodeRef, parentRef, now),
        );
      }),
    );
  }

  // edgeLayouts
  if (sheet.edgeLayouts && sheet.edgeLayouts.length > 0) {
    await Promise.all(
      sheet.edgeLayouts.map(async (layout) => {
        const edgeRef = edgeIdToRef.get(layout.edgeId);
        if (!edgeRef) return;
        const rkey = makeRkey(branchId, layout.edgeId);
        await edgeLayouts.put(rkey, edgeLayoutToRecord(layout, edgeRef, now));
      }),
    );
  }

  // 削除された node/edge のレコードをクリーンアップ
  await cleanupBranchDeletedRecords(
    sheet.nodes.map((n) => n.id as string),
    sheet.edges.map((e) => e.id as string),
    branchId,
    sheetId,
  );
}

async function cleanupBranchDeletedRecords(
  currentNodeIds: string[],
  currentEdgeIds: string[],
  branchId: string,
  sheetId: SheetId,
): Promise<void> {
  const [existingNodes, existingEdges] = await Promise.all([
    nodes.listForPrefix(branchId),
    edges.listForPrefix(branchId),
  ]);

  const currentNodeIdSet = new Set(currentNodeIds);
  const currentEdgeIdSet = new Set(currentEdgeIds);

  await Promise.all([
    ...existingNodes
      .filter((r) => {
        const rec = r.value as NodeRecord;
        const nodeId = idFromRkey(rkeyFromUri(r.uri));
        return (
          rkeyFromUri(rec.sheet.uri) === sheetId &&
          !currentNodeIdSet.has(nodeId)
        );
      })
      .map((r) => nodes.delete(rkeyFromUri(r.uri))),
    ...existingEdges
      .filter((r) => {
        const rec = r.value as EdgeRecord;
        const edgeId = idFromRkey(rkeyFromUri(r.uri));
        return (
          rkeyFromUri(rec.sheet.uri) === sheetId &&
          !currentEdgeIdSet.has(edgeId)
        );
      })
      .map((r) => edges.delete(rkeyFromUri(r.uri))),
  ]);
}

/** branch を trunk へ merge: branch の node/edge/layout を trunk に書き替え */
export async function mergeBranchToTrunk(
  branch: Branch,
  sheetId: SheetId,
  sheetRef: StrongRef,
): Promise<void> {
  const _now = new Date().toISOString();

  const [branchNodes, branchEdges, branchNodeLayouts, branchEdgeLayouts] =
    await Promise.all([
      nodes.listForPrefix(branch.id),
      edges.listForPrefix(branch.id),
      nodeLayouts.listForPrefix(branch.id),
      edgeLayouts.listForPrefix(branch.id),
    ]);

  const sheetBranchNodes = branchNodes.filter(
    (r) => rkeyFromUri((r.value as NodeRecord).sheet.uri) === sheetId,
  );
  const sheetBranchEdges = branchEdges.filter(
    (r) => rkeyFromUri((r.value as EdgeRecord).sheet.uri) === sheetId,
  );
  const branchNodeUriSet = new Set(sheetBranchNodes.map((r) => r.uri));
  const branchEdgeUriSet = new Set(sheetBranchEdges.map((r) => r.uri));

  // 1. branch nodes → trunk rkey で PUT
  const nodeIdToTrunkRef = new Map<string, StrongRef>();
  await Promise.all(
    sheetBranchNodes.map(async (r) => {
      const nodeId = idFromRkey(rkeyFromUri(r.uri));
      const rec = r.value as NodeRecord;
      const { $type: _, ...data } = rec;
      const trunkRkey = makeRkey(TRUNK_PREFIX, nodeId);
      const result = await nodes.put(trunkRkey, { ...data, sheet: sheetRef });
      nodeIdToTrunkRef.set(nodeId, { uri: result.uri, cid: result.cid });
    }),
  );

  // 2. branch edges → trunk rkey で PUT
  const edgeIdToTrunkRef = new Map<string, StrongRef>();
  await Promise.all(
    sheetBranchEdges.map(async (r) => {
      const edgeId = idFromRkey(rkeyFromUri(r.uri));
      const rec = r.value as EdgeRecord;
      const sourceId = idFromRkey(rkeyFromUri(rec.source.uri));
      const targetId = idFromRkey(rkeyFromUri(rec.target.uri));
      const sourceRef = nodeIdToTrunkRef.get(sourceId);
      const targetRef = nodeIdToTrunkRef.get(targetId);
      if (!sourceRef || !targetRef) return;
      const { $type: _, ...data } = rec;
      const trunkRkey = makeRkey(TRUNK_PREFIX, edgeId);
      const result = await edges.put(trunkRkey, {
        ...data,
        sheet: sheetRef,
        source: sourceRef,
        target: targetRef,
      });
      edgeIdToTrunkRef.set(edgeId, { uri: result.uri, cid: result.cid });
    }),
  );

  // 3. branch で削除されたノード/エッジを trunk からも削除
  const [trunkNodes, trunkEdges] = await Promise.all([
    nodes.listForPrefix(TRUNK_PREFIX),
    edges.listForPrefix(TRUNK_PREFIX),
  ]);
  const branchNodeIds = new Set(
    sheetBranchNodes.map((r) => idFromRkey(rkeyFromUri(r.uri))),
  );
  const branchEdgeIds = new Set(
    sheetBranchEdges.map((r) => idFromRkey(rkeyFromUri(r.uri))),
  );

  await Promise.all([
    ...trunkNodes
      .filter((r) => {
        const rec = r.value as NodeRecord;
        return (
          rkeyFromUri(rec.sheet.uri) === sheetId &&
          !branchNodeIds.has(idFromRkey(rkeyFromUri(r.uri)))
        );
      })
      .map((r) => nodes.delete(rkeyFromUri(r.uri))),
    ...trunkEdges
      .filter((r) => {
        const rec = r.value as EdgeRecord;
        return (
          rkeyFromUri(rec.sheet.uri) === sheetId &&
          !branchEdgeIds.has(idFromRkey(rkeyFromUri(r.uri)))
        );
      })
      .map((r) => edges.delete(rkeyFromUri(r.uri))),
  ]);

  // 4. nodeLayouts / edgeLayouts → trunk rkey で PUT
  await Promise.all([
    ...branchNodeLayouts
      .filter((r) =>
        branchNodeUriSet.has((r.value as NodeLayoutRecord).node.uri),
      )
      .map(async (r) => {
        const rec = r.value as NodeLayoutRecord;
        const nodeId = idFromRkey(rkeyFromUri(rec.node.uri));
        const trunkNodeRef = nodeIdToTrunkRef.get(nodeId);
        if (!trunkNodeRef) return;
        const parentId = rec.parent
          ? idFromRkey(rkeyFromUri(rec.parent.uri))
          : undefined;
        const parentRef = parentId ? nodeIdToTrunkRef.get(parentId) : undefined;
        const { $type: _, ...data } = rec;
        const trunkRkey = makeRkey(TRUNK_PREFIX, nodeId);
        await nodeLayouts.put(trunkRkey, {
          ...data,
          node: trunkNodeRef,
          ...(parentRef && { parent: parentRef }),
        });
      }),
    ...branchEdgeLayouts
      .filter((r) =>
        branchEdgeUriSet.has((r.value as EdgeLayoutRecord).edge.uri),
      )
      .map(async (r) => {
        const rec = r.value as EdgeLayoutRecord;
        const edgeId = idFromRkey(rkeyFromUri(rec.edge.uri));
        const trunkEdgeRef = edgeIdToTrunkRef.get(edgeId);
        if (!trunkEdgeRef) return;
        const { $type: _, ...data } = rec;
        const trunkRkey = makeRkey(TRUNK_PREFIX, edgeId);
        await edgeLayouts.put(trunkRkey, { ...data, edge: trunkEdgeRef });
      }),
  ]);
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

/** branch とその全 node/edge/layout/commit レコードを PDS から削除 */
export async function deleteBranchWithRecords(branch: Branch): Promise<void> {
  const [
    branchNodes,
    branchEdges,
    branchNodeLayouts,
    branchEdgeLayouts,
    branchCommits,
  ] = await Promise.all([
    nodes.listForPrefix(branch.id),
    edges.listForPrefix(branch.id),
    nodeLayouts.listForPrefix(branch.id),
    edgeLayouts.listForPrefix(branch.id),
    fetchCommitsForBranch(branch.uri),
  ]);

  await Promise.all([
    ...branchNodes.map((r) => nodes.delete(rkeyFromUri(r.uri))),
    ...branchEdges.map((r) => edges.delete(rkeyFromUri(r.uri))),
    ...branchNodeLayouts.map((r) => nodeLayouts.delete(rkeyFromUri(r.uri))),
    ...branchEdgeLayouts.map((r) => edgeLayouts.delete(rkeyFromUri(r.uri))),
    ...branchCommits.map((c) => commits.delete(c.id)),
    branches.delete(branch.id),
  ]);
}

/** commit を作成して ATProto に保存 */
export async function createCommit(
  message: string,
  operations: CommitOperation[],
  sheetRef: StrongRef,
  branchRef: StrongRef,
  parentCommitRef?: StrongRef,
  treeRefs?: StrongRef[],
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
    ...(treeRefs && treeRefs.length > 0 && { tree: treeRefs }),
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
