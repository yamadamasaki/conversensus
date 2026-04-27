import type { GraphFile, Sheet, SheetId } from '@conversensus/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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

interface UseBranchOperationsParams {
  activeFile: GraphFile | null;
  activeSheetId: SheetId | null;
  activeSheet: Sheet | null;
  onSetActiveFile: (file: GraphFile | null) => void;
  setConfirmState: (s: ConfirmState | null) => void;
  setInputState: (s: InputState | null) => void;
  setAlertState: (s: AlertState | null) => void;
}

export function useBranchOperations({
  activeFile,
  activeSheetId,
  activeSheet,
  onSetActiveFile,
  setConfirmState,
  setInputState,
  setAlertState,
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
  const preBranchFile = useRef<GraphFile | null>(null);
  const latestCommitRef = useRef<{ uri: string; cid: string } | null>(null);

  const isTrunk = !activeBranch || activeBranch.name === 'trunk';

  const [branchDiffNodeIds, branchDiffEdgeIds] = useMemo(() => {
    if (isTrunk || !branchOriginalBase || !activeSheet) {
      return [new Set<string>(), new Set<string>()] as const;
    }
    const ops = computeOperations(branchOriginalBase, activeSheet);
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();
    for (const op of ops) {
      if ('nodeId' in op) nodeIds.add(op.nodeId);
      else if ('edgeId' in op) edgeIds.add(op.edgeId);
    }
    return [nodeIds, edgeIds] as const;
  }, [isTrunk, branchOriginalBase, activeSheet]);

  const pendingOps = useMemo(() => {
    if (isTrunk || !lastCommitBase || !activeSheet) return [];
    return computeOperations(lastCommitBase, activeSheet);
  }, [isTrunk, lastCommitBase, activeSheet]);

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

      if (!branch || branch.name === 'trunk') {
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
        const branchSheet = await fetchBranchSheetFromPds(branch.id, sheetId);
        const cs = await fetchCommitsForBranch(branch.uri);

        preBranchFile.current = activeFile ?? null;

        let originalBase: typeof branchSheet;
        if (branch.status === 'merged') {
          originalBase = await fetchBranchSheetFromPds(TRUNK_PREFIX, sheetId);
        } else {
          const storedOriginal = branchOriginalBaseMap.current.get(branch.uri);
          originalBase = storedOriginal ?? branchSheet;
          if (!storedOriginal) {
            branchOriginalBaseMap.current.set(branch.uri, originalBase);
          }
        }
        setBranchOriginalBase(originalBase);
        setLastCommitBase(branchSheet);

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

        setNewCommitsSinceMerge(branch.status === 'merged' ? 0 : cs.length);
        setActiveBranch(branch);
      } catch (err) {
        console.warn('[branch] select failed:', err);
      }
    },
    [activeFile, onSetActiveFile],
  );

  const handleCreateBranch = useCallback(
    async (sheetId: SheetId) => {
      const name = await new Promise<string>((resolve) => {
        setInputState({ message: 'branch 名を入力してください:', resolve });
      });
      if (!name?.trim()) return;
      try {
        const sheetRef = await sheets.ref(sheetId);
        const branch = await createBranch(name.trim(), sheetId, sheetRef);
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
    [setInputState, setAlertState],
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
        const sheetRef = await sheets.ref(activeSheetId);
        const branchRef = { uri: branch.uri, cid: branch.cid };
        const latestCommit = latestCommitRef.current ?? undefined;

        await mergeBranchToTrunk(branch, activeSheetId, sheetRef);
        await createMergeRecord(branch, sheetRef, branchRef, latestCommit);
        const mergedBranch = await updateBranchStatus(branch, 'merged');

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
        setNewCommitsSinceMerge(0);
      } catch (err) {
        console.warn('[branch] merge failed:', err);
        await new Promise<void>((resolve) => {
          setAlertState({ message: 'merge に失敗しました。', resolve });
        });
      }
    },
    [activeSheetId, activeFile, activeSheet, setConfirmState, setAlertState],
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
        const closedBranch = await updateBranchStatus(branch, 'closed');
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
    [activeBranch, onSetActiveFile, setConfirmState, setAlertState],
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
        await deleteBranchWithRecords(branch);
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
    [activeBranch, onSetActiveFile, setConfirmState, setAlertState],
  );

  const handleCommit = useCallback(
    async (message: string) => {
      if (!activeBranch || !activeSheetId || !activeSheet) return;
      if (pendingOps.length === 0) return;

      try {
        const sheetRef = await sheets.ref(activeSheetId);
        const branchRef = { uri: activeBranch.uri, cid: activeBranch.cid };
        const parentRef = latestCommitRef.current ?? undefined;

        const commit = await createCommit(
          message,
          pendingOps,
          sheetRef,
          branchRef,
          parentRef,
        );
        latestCommitRef.current = { uri: commit.uri, cid: commit.cid };

        setLastCommitBase(activeSheet);
        setNewCommitsSinceMerge((prev) => prev + 1);
        setCommitDialogOpen(false);
      } catch (err) {
        console.warn('[commit] create failed:', err);
        await new Promise<void>((resolve) => {
          setAlertState({ message: 'コミットに失敗しました。', resolve });
        });
      }
    },
    [activeBranch, activeSheetId, activeSheet, pendingOps, setAlertState],
  );

  // activeSheetId が変わったら branches を fetch
  useEffect(() => {
    if (!activeSheetId) return;
    fetchBranchesForSheet(activeSheetId)
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
  }, [activeSheetId]);

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
