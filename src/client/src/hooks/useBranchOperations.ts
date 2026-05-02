import type {
  EdgeLayout,
  GraphEdge,
  GraphFile,
  GraphNode,
  NodeLayout,
  Sheet,
  SheetId,
} from '@conversensus/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BRANCH_STATUS,
  type Branch,
  computeOperations,
  createBranch,
  createCommit,
  createMergeRecord,
  deleteBranchWithRecords,
  fetchBranchesForSheet,
  fetchBranchSheetFromPds,
  fetchCommitsForBranch,
  mergeBranchToTrunk,
  sheets,
  syncFileToAtproto,
  TRUNK_PREFIX,
  updateBranchStatus,
} from '../atproto';

type ConfirmState = {
  message: string;
  resolve: (ok: boolean) => void;
};

type InputState = {
  message: string;
  resolve: (value: string) => void;
};

type AlertState = {
  message: string;
  resolve: () => void;
};

export interface BranchOpsDeps {
  computeOperations: typeof computeOperations;
  createBranch: typeof createBranch;
  createCommit: typeof createCommit;
  createMergeRecord: typeof createMergeRecord;
  deleteBranchWithRecords: typeof deleteBranchWithRecords;
  fetchBranchesForSheet: typeof fetchBranchesForSheet;
  fetchBranchSheetFromPds: typeof fetchBranchSheetFromPds;
  fetchCommitsForBranch: typeof fetchCommitsForBranch;
  mergeBranchToTrunk: typeof mergeBranchToTrunk;
  sheetsRef: (sheetId: string) => Promise<{ uri: string; cid: string }>;
  updateBranchStatus: typeof updateBranchStatus;
  syncFileToAtproto: typeof syncFileToAtproto;
  TRUNK_PREFIX: string;
}

export const defaultBranchOpsDeps: BranchOpsDeps = {
  computeOperations,
  createBranch,
  createCommit,
  createMergeRecord,
  deleteBranchWithRecords,
  fetchBranchesForSheet,
  fetchBranchSheetFromPds,
  fetchCommitsForBranch,
  mergeBranchToTrunk,
  sheetsRef: (sheetId) => sheets.ref(sheetId),
  updateBranchStatus,
  syncFileToAtproto,
  TRUNK_PREFIX,
};

interface UseBranchOperationsParams {
  activeFile: GraphFile | null;
  activeSheetId: SheetId | null;
  activeSheet: Sheet | null;
  onSetActiveFile: (file: GraphFile | null) => void;
  setConfirmState: (s: ConfirmState | null) => void;
  setInputState: (s: InputState | null) => void;
  setAlertState: (s: AlertState | null) => void;
  deps?: BranchOpsDeps;
}

export function useBranchOperations({
  activeFile,
  activeSheetId,
  activeSheet,
  onSetActiveFile,
  setConfirmState,
  setInputState,
  setAlertState,
  deps = defaultBranchOpsDeps,
}: UseBranchOperationsParams) {
  const [activeBranch, setActiveBranch] = useState<Branch | null>(null);
  const [sheetBranches, setSheetBranches] = useState<Map<string, Branch[]>>(
    new Map(),
  );
  const [newCommitsSinceMerge, setNewCommitsSinceMerge] = useState(0);
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);

  const [lastCommitBase, setLastCommitBase] = useState<Sheet | null>(null);
  const [branchOriginalBase, setBranchOriginalBase] = useState<Sheet | null>(
    null,
  );
  const branchOriginalBaseMap = useRef<Map<string, Sheet>>(new Map());
  const lastCommitBaseMap = useRef<Map<string, Sheet>>(new Map());
  const preBranchFile = useRef<GraphFile | null>(null);
  const latestCommitRef = useRef<{ uri: string; cid: string } | null>(null);

  const isTrunk = !activeBranch || activeBranch.name === TRUNK_PREFIX;

  // File が切り替わったらブランチ状態をリセット
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeFile?.id の変化をトリガーにする意図的な設計
  useEffect(() => {
    setActiveBranch(null);
    setLastCommitBase(null);
    setBranchOriginalBase(null);
    setNewCommitsSinceMerge(0);
    branchOriginalBaseMap.current.clear();
    lastCommitBaseMap.current.clear();
    preBranchFile.current = null;
    latestCommitRef.current = null;
  }, [activeFile?.id]);

  const [branchDiffNodeIds, branchDiffEdgeIds] = useMemo(() => {
    if (isTrunk || !branchOriginalBase || !activeSheet) {
      return [new Set<string>(), new Set<string>()] as const;
    }
    const ops = deps.computeOperations(branchOriginalBase, activeSheet);
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();
    for (const op of ops) {
      // 削除は conflicted に含めない（ゴースト表示用に別途計算）
      if (op.op === 'node.remove' || op.op === 'edge.remove') continue;
      if ('nodeId' in op) nodeIds.add(op.nodeId);
      else if ('edgeId' in op) edgeIds.add(op.edgeId);
    }
    return [nodeIds, edgeIds] as const;
  }, [isTrunk, branchOriginalBase, activeSheet, deps]);

  // 削除予定のノード/エッジ（base に存在し current に存在しない）
  const [deletedNodes, deletedEdges, deletedNodeLayouts, deletedEdgeLayouts] =
    useMemo(() => {
      if (isTrunk || !branchOriginalBase || !activeSheet) {
        return [[], [], [], []] as const;
      }
      const ops = deps.computeOperations(branchOriginalBase, activeSheet);
      const removedNodeIds = new Set<string>();
      const removedEdgeIds = new Set<string>();
      for (const op of ops) {
        if (op.op === 'node.remove') removedNodeIds.add(op.nodeId);
        if (op.op === 'edge.remove') removedEdgeIds.add(op.edgeId);
      }
      return [
        branchOriginalBase.nodes.filter((n) => removedNodeIds.has(n.id)),
        branchOriginalBase.edges.filter((e) => removedEdgeIds.has(e.id)),
        (branchOriginalBase.layouts ?? []).filter((l) =>
          removedNodeIds.has(l.nodeId),
        ),
        (branchOriginalBase.edgeLayouts ?? []).filter((l) =>
          removedEdgeIds.has(l.edgeId),
        ),
      ] as const;
    }, [isTrunk, branchOriginalBase, activeSheet, deps]);

  const pendingOps = useMemo(() => {
    if (
      isTrunk ||
      !lastCommitBase ||
      !activeSheet ||
      (activeBranch?.status !== BRANCH_STATUS.OPEN &&
        activeBranch?.status !== BRANCH_STATUS.MERGED)
    )
      return [];
    return deps.computeOperations(lastCommitBase, activeSheet);
  }, [isTrunk, lastCommitBase, activeSheet, activeBranch?.status, deps]);

  const resetBranchState = useCallback(() => {
    setActiveBranch(null);
    setLastCommitBase(null);
    setBranchOriginalBase(null);
    setNewCommitsSinceMerge(0);
    if (preBranchFile.current) {
      onSetActiveFile(preBranchFile.current);
      preBranchFile.current = null;
    }
  }, [onSetActiveFile]);

  const setBranchBases = useCallback((sheet: Sheet) => {
    setBranchOriginalBase(sheet);
    setLastCommitBase(sheet);
  }, []);

  const handleSelectBranch = useCallback(
    async (sheetId: SheetId, branch: Branch | null) => {
      latestCommitRef.current = null;

      if (!branch || branch.name === TRUNK_PREFIX) {
        setActiveBranch(branch);
        setLastCommitBase(null);
        setBranchOriginalBase(null);
        setNewCommitsSinceMerge(0);
        if (preBranchFile.current) {
          onSetActiveFile(preBranchFile.current);
          preBranchFile.current = null;
        }
        return;
      }

      try {
        const branchSheet = await deps.fetchBranchSheetFromPds(
          branch.id,
          sheetId,
        );
        const cs = await deps.fetchCommitsForBranch(branch.uri);

        // trunk からブランチに入る時のみ trunk の状態を保存
        if (!activeBranch || activeBranch.name === TRUNK_PREFIX) {
          preBranchFile.current = activeFile ?? null;
        }

        let originalBase: typeof branchSheet;
        if (branch.status === BRANCH_STATUS.MERGED) {
          originalBase = await deps.fetchBranchSheetFromPds(
            deps.TRUNK_PREFIX,
            sheetId,
          );
        } else {
          const storedOriginal = branchOriginalBaseMap.current.get(branch.uri);
          originalBase = storedOriginal ?? branchSheet;
          if (!storedOriginal) {
            branchOriginalBaseMap.current.set(branch.uri, originalBase);
          }
        }
        setBranchOriginalBase(originalBase);
        if (branch.status === BRANCH_STATUS.OPEN) {
          const storedLastBase = lastCommitBaseMap.current.get(branch.uri);
          if (storedLastBase) {
            setLastCommitBase(storedLastBase);
          } else {
            setLastCommitBase(originalBase);
            lastCommitBaseMap.current.set(branch.uri, originalBase);
          }
        } else {
          setLastCommitBase(null);
        }

        if (cs.length > 0) {
          const last = cs[cs.length - 1];
          latestCommitRef.current = { uri: last.uri, cid: last.cid };
        }

        if (activeFile) {
          onSetActiveFile({
            ...activeFile,
            sheets: activeFile.sheets.map((s) =>
              s.id === sheetId ? branchSheet : s,
            ),
          });
        }

        setNewCommitsSinceMerge(
          branch.status === BRANCH_STATUS.MERGED ? 0 : cs.length,
        );
        setActiveBranch(branch);
      } catch (err) {
        console.warn('[branch] select failed:', err);
      }
    },
    [activeFile, onSetActiveFile, deps, activeBranch],
  );

  const handleCreateBranch = useCallback(
    async (sheetId: SheetId) => {
      const name = await new Promise<string>((resolve) => {
        setInputState({ message: 'branch 名を入力してください:', resolve });
      });
      if (!name?.trim()) return;
      try {
        let sheetRef: { uri: string; cid: string };
        try {
          sheetRef = await deps.sheetsRef(sheetId);
        } catch {
          if (!activeFile) throw new Error('アクティブなファイルがありません');
          await deps.syncFileToAtproto(activeFile);
          sheetRef = await deps.sheetsRef(sheetId);
        }
        const branch = await deps.createBranch(name.trim(), sheetId, sheetRef);
        setSheetBranches((prev) => {
          const next = new Map(prev);
          const existing = next.get(sheetId) ?? [];
          next.set(sheetId, [...existing, branch]);
          return next;
        });
      } catch (err) {
        console.warn('[branch] create failed:', err);
        await new Promise<void>((resolve) => {
          setAlertState({
            message:
              'branch の作成に失敗しました。ATProto にログインしているか確認してください。',
            resolve,
          });
        });
      }
    },
    [activeFile, setInputState, setAlertState, deps],
  );

  const handleMergeBranch = useCallback(
    async (branch: Branch) => {
      if (!activeSheetId || !activeFile) return;
      const ok = await new Promise<boolean>((resolve) => {
        setConfirmState({
          message: `branch "${branch.name}" を trunk に merge しますか？`,
          resolve,
        });
      });
      if (!ok) return;
      try {
        const sheetRef = await deps.sheetsRef(activeSheetId);
        const branchRef = { uri: branch.uri, cid: branch.cid };
        const latestCommit = latestCommitRef.current ?? undefined;

        await deps.mergeBranchToTrunk(branch, activeSheetId, sheetRef);
        await deps.createMergeRecord(branch, sheetRef, branchRef, latestCommit);
        const mergedBranch = await deps.updateBranchStatus(
          branch,
          BRANCH_STATUS.MERGED,
        );

        setSheetBranches((prev) => {
          const next = new Map(prev);
          const existing = next.get(activeSheetId) ?? [];
          next.set(
            activeSheetId,
            existing.map((b) => (b.id === branch.id ? mergedBranch : b)),
          );
          return next;
        });

        if (activeFile && activeSheet) {
          preBranchFile.current = {
            ...activeFile,
            sheets: activeFile.sheets.map((s) =>
              s.id === activeSheetId ? activeSheet : s,
            ),
          };
        }

        setActiveBranch(mergedBranch);
        setBranchOriginalBase(activeSheet ?? null);
        setLastCommitBase(activeSheet ?? null);
        lastCommitBaseMap.current.delete(branch.uri);
        setNewCommitsSinceMerge(0);
      } catch (err) {
        console.warn('[branch] merge failed:', err);
        await new Promise<void>((resolve) => {
          setAlertState({ message: 'merge に失敗しました。', resolve });
        });
      }
    },
    [
      activeSheetId,
      activeFile,
      activeSheet,
      setConfirmState,
      setAlertState,
      deps,
    ],
  );

  const handleCloseBranch = useCallback(
    async (branch: Branch) => {
      const ok = await new Promise<boolean>((resolve) => {
        setConfirmState({
          message: `branch "${branch.name}" を close しますか？`,
          resolve,
        });
      });
      if (!ok) return;
      try {
        const closedBranch = await deps.updateBranchStatus(
          branch,
          BRANCH_STATUS.CLOSED,
        );
        setSheetBranches((prev) => {
          const next = new Map(prev);
          const sheetId = branch.sheetId;
          const existing = next.get(sheetId) ?? [];
          next.set(
            sheetId,
            existing.map((b) => (b.id === branch.id ? closedBranch : b)),
          );
          return next;
        });
        if (activeBranch?.id === branch.id) {
          lastCommitBaseMap.current.delete(activeBranch.uri);
          setActiveBranch(null);
          setLastCommitBase(null);
          setBranchOriginalBase(null);
          if (preBranchFile.current) {
            onSetActiveFile(preBranchFile.current);
            preBranchFile.current = null;
          }
        }
      } catch (err) {
        console.warn('[branch] close failed:', err);
        await new Promise<void>((resolve) => {
          setAlertState({ message: 'close に失敗しました。', resolve });
        });
      }
    },
    [activeBranch, onSetActiveFile, setConfirmState, setAlertState, deps],
  );

  const handleDeleteBranch = useCallback(
    async (branch: Branch) => {
      const ok = await new Promise<boolean>((resolve) => {
        setConfirmState({
          message: `branch "${branch.name}" を削除しますか？\nこの操作は取り消せません。`,
          resolve,
        });
      });
      if (!ok) return;
      try {
        await deps.deleteBranchWithRecords(branch);
        setSheetBranches((prev) => {
          const next = new Map(prev);
          const sheetId = branch.sheetId;
          next.set(
            sheetId,
            (next.get(sheetId) ?? []).filter((b) => b.id !== branch.id),
          );
          return next;
        });
        if (activeBranch?.id === branch.id) {
          lastCommitBaseMap.current.delete(activeBranch.uri);
          setActiveBranch(null);
          setLastCommitBase(null);
          setBranchOriginalBase(null);
          if (preBranchFile.current) {
            onSetActiveFile(preBranchFile.current);
            preBranchFile.current = null;
          }
        }
      } catch (err) {
        console.warn('[branch] delete failed:', err);
        await new Promise<void>((resolve) => {
          setAlertState({ message: '削除に失敗しました。', resolve });
        });
      }
    },
    [activeBranch, onSetActiveFile, setConfirmState, setAlertState, deps],
  );

  const handleCommit = useCallback(
    async (message: string) => {
      if (!activeBranch || !activeSheetId || !activeSheet) return;
      if (pendingOps.length === 0) return;

      try {
        const sheetRef = await deps.sheetsRef(activeSheetId);
        const branchRef = { uri: activeBranch.uri, cid: activeBranch.cid };
        const parentRef = latestCommitRef.current ?? undefined;

        const commit = await deps.createCommit(
          message,
          pendingOps,
          sheetRef,
          branchRef,
          parentRef,
        );
        latestCommitRef.current = { uri: commit.uri, cid: commit.cid };

        setLastCommitBase(activeSheet);
        lastCommitBaseMap.current.set(activeBranch.uri, activeSheet);
        setNewCommitsSinceMerge((prev) => prev + 1);
        setCommitDialogOpen(false);
      } catch (err) {
        console.warn('[commit] create failed:', err);
        await new Promise<void>((resolve) => {
          setAlertState({ message: 'コミットに失敗しました。', resolve });
        });
      }
    },
    [activeBranch, activeSheetId, activeSheet, pendingOps, setAlertState, deps],
  );

  // activeSheetId が変わったら branches を fetch
  useEffect(() => {
    if (!activeSheetId) return;
    deps
      .fetchBranchesForSheet(activeSheetId)
      .then((bs) => {
        setSheetBranches((prev) => {
          const next = new Map(prev);
          next.set(activeSheetId, bs);
          return next;
        });
      })
      .catch(() => {
        // ATProto 未ログイン時はサイレントスキップ
      });
  }, [activeSheetId, deps]);

  return {
    activeBranch,
    sheetBranches,
    newCommitsSinceMerge,
    commitDialogOpen,
    setCommitDialogOpen,
    isTrunk,
    branchDiffNodeIds,
    branchDiffEdgeIds,
    conflictedNodeIds: branchDiffNodeIds,
    conflictedEdgeIds: branchDiffEdgeIds,
    deletedNodes: deletedNodes as GraphNode[],
    deletedEdges: deletedEdges as GraphEdge[],
    deletedNodeLayouts: deletedNodeLayouts as NodeLayout[],
    deletedEdgeLayouts: deletedEdgeLayouts as EdgeLayout[],
    pendingOps,
    handleSelectBranch,
    handleCreateBranch,
    handleMergeBranch,
    handleCloseBranch,
    handleDeleteBranch,
    handleCommit,
    resetBranchState,
    setBranchBases,
  };
}
