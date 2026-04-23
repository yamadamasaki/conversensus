import type {
  ConversensusFile,
  GraphFile,
  GraphFileListItem,
  Sheet,
  SheetId,
} from '@conversensus/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createFile,
  exportFile,
  fetchFile,
  fetchFiles,
  importFile,
  removeFile,
  saveFile,
} from './api';
import {
  applyOperations,
  files as atprotoFilesColl,
  type Branch,
  type Commit,
  computeOperations,
  createBranch,
  createCommit,
  createMergeRecord,
  deleteBranchFromPds,
  fetchBranchesForSheet,
  fetchCommitsForBranch,
  fetchFileFromAtproto,
  fetchFilesFromAtproto,
  initCidCacheFromPds,
  login,
  NSID,
  type RemoteChange,
  sheets,
  startPolling,
  stopPolling,
  syncFileToAtproto,
  updateBranchStatus,
} from './atproto';
import { BranchDeleteDialog } from './BranchDeleteDialog';
import { CommitDialog } from './CommitDialog';
import { ConflictPanel } from './ConflictPanel';
import { GraphEditor } from './GraphEditor';
import { MergeDialog } from './MergeDialog';
import type { PopupTarget } from './SettingsPopup';
import { Sidebar } from './Sidebar';

const AUTOSAVE_DELAY = 1000; // ms

/**
 * ローカル開発専用: VITE_ATPROTO_* は Vite がビルド時にバンドルへ展開するため
 * 本番ビルドでは絶対に使用しないこと。import.meta.env.DEV でガード済み。
 * 本番環境ではログイン UI を実装すること。
 */
async function tryAtprotoAutoLogin(): Promise<void> {
  if (!import.meta.env.DEV) return;
  const handle = import.meta.env.VITE_ATPROTO_HANDLE;
  const password = import.meta.env.VITE_ATPROTO_PASSWORD;
  if (!handle || !password) return;
  try {
    await login(handle, password);
    console.info('[atproto] auto-login:', handle);
  } catch (err) {
    console.warn('[atproto] auto-login failed (sync disabled):', err);
  }
}

export default function App() {
  const [files, setFiles] = useState<GraphFileListItem[]>([]);
  const [activeFile, setActiveFile] = useState<GraphFile | null>(null);
  const [activeSheetId, setActiveSheetId] = useState<SheetId | null>(null);
  const [expandedFileIds, setExpandedFileIds] = useState<Set<string>>(
    new Set(),
  );
  const [newFileName, setNewFileName] = useState('');
  const [popupTarget, setPopupTarget] = useState<PopupTarget | null>(null);
  // リモート変更検出: ポーリングで検出された他ユーザーの変更
  const [remoteChanges, setRemoteChanges] = useState<RemoteChange[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Branch / Commit state
  const [activeBranch, setActiveBranch] = useState<Branch | null>(null);
  const [sheetBranches, setSheetBranches] = useState<Map<string, Branch[]>>(
    new Map(),
  );
  const [branchCommits, setBranchCommits] = useState<Commit[]>([]);
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [deleteBranchState, setDeleteBranchState] = useState<{
    sheetId: SheetId;
    branch: Branch;
    commits: Commit[];
    hasPendingChanges: boolean;
  } | null>(null);
  // branch mode の base state (commit のたびに更新)
  const branchBaseSheet = useRef<Sheet | null>(null);
  // branchBaseSheet の更新を useMemo に伝えるためのカウンタ (ref は deps に入れられないため)
  const [branchBaseVersion, setBranchBaseVersion] = useState(0);
  // branch 開始時の元 sheet (コミットをまたいでも変わらない: diff ハイライト用)
  const branchOriginalBase = useRef<Sheet | null>(null);
  // branch URI → 最初に入ったときの trunk Sheet (trunk↔branch を行き来しても diff 基点を保持)
  const branchOriginalBaseMap = useRef<Map<string, Sheet>>(new Map());
  // branch 開始前の activeFile (branch 離脱時に復元するため)
  const preBranchFile = useRef<GraphFile | null>(null);
  // 最新 commit ref (parentCommit チェーン用)
  const latestCommitRef = useRef<{ uri: string; cid: string } | null>(null);

  // 'update' のみをオレンジハイライト対象とする (新規追加 'add' はハイライト不要)
  const remoteConflictedNodeIds = useMemo(
    () =>
      new Set(
        remoteChanges
          .filter(
            (c) =>
              c.changeType === 'update' &&
              (c.collection === NSID.node || c.collection === NSID.nodeLayout),
          )
          .map((c) => c.rkey),
      ),
    [remoteChanges],
  );
  const remoteConflictedEdgeIds = useMemo(
    () =>
      new Set(
        remoteChanges
          .filter(
            (c) =>
              c.changeType === 'update' &&
              (c.collection === NSID.edge || c.collection === NSID.edgeLayout),
          )
          .map((c) => c.rkey),
      ),
    [remoteChanges],
  );

  const activeSheet = useMemo(
    () => activeFile?.sheets.find((s) => s.id === activeSheetId) ?? null,
    [activeFile, activeSheetId],
  );

  // branch が選択されている場合、originalBase + committedOps + pendingEdits で表示状態を構築
  // (activeSheet をそのまま base にすると commit 後に ops が二重適用される)
  // biome-ignore lint/correctness/useExhaustiveDependencies: branchBaseVersion は ref 更新を useMemo に伝えるためのカウンタ
  const displaySheet = useMemo((): Sheet | null => {
    if (!activeSheet) return null;
    if (!activeBranch || activeBranch.name === 'main') return activeSheet;
    const allCommittedOps = branchCommits.flatMap((c) => c.operations);
    const originalBase = branchOriginalBase.current ?? activeSheet;
    const committedState = applyOperations(originalBase, allCommittedOps);
    const pending = branchBaseSheet.current
      ? computeOperations(branchBaseSheet.current, activeSheet)
      : [];
    return applyOperations(committedState, pending);
  }, [activeSheet, activeBranch, branchCommits, branchBaseVersion]);

  // branch モード時: base sheet との差分ノード/エッジをハイライト
  // biome-ignore lint/correctness/useExhaustiveDependencies: branchBaseVersion は ref 更新を useMemo に伝えるためのカウンタ
  const [branchDiffNodeIds, branchDiffEdgeIds] = useMemo(() => {
    if (!activeBranch || activeBranch.name === 'main') {
      return [new Set<string>(), new Set<string>()] as const;
    }
    const base = branchOriginalBase.current;
    if (!base || !displaySheet) {
      return [new Set<string>(), new Set<string>()] as const;
    }
    const ops = computeOperations(base, displaySheet);
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();
    for (const op of ops) {
      if ('nodeId' in op) nodeIds.add(op.nodeId);
      else if ('edgeId' in op) edgeIds.add(op.edgeId);
    }
    return [nodeIds, edgeIds] as const;
  }, [activeBranch, displaySheet, branchBaseVersion]);

  const conflictedNodeIds =
    activeBranch && activeBranch.name !== 'main'
      ? branchDiffNodeIds
      : remoteConflictedNodeIds;
  const conflictedEdgeIds =
    activeBranch && activeBranch.name !== 'main'
      ? branchDiffEdgeIds
      : remoteConflictedEdgeIds;

  // 現在の branch での pending operations (未コミットの変更)
  // biome-ignore lint/correctness/useExhaustiveDependencies: branchBaseVersion は ref 更新を useMemo に伝えるためのカウンタ
  const pendingOps = useMemo(() => {
    if (!branchBaseSheet.current || !activeSheet) return [];
    if (!activeBranch || activeBranch.name === 'main') return [];
    return computeOperations(branchBaseSheet.current, activeSheet);
  }, [activeSheet, activeBranch, branchBaseVersion]);

  // branch が選択されている場合、displaySheet を activeFile に反映した仮の file を GraphEditor に渡す
  const displayFile = useMemo((): GraphFile | null => {
    if (!activeFile || !displaySheet || !activeSheetId) return activeFile;
    if (!activeBranch || activeBranch.name === 'main') return activeFile;
    return {
      ...activeFile,
      sheets: activeFile.sheets.map((s) =>
        s.id === activeSheetId ? displaySheet : s,
      ),
    };
  }, [activeFile, displaySheet, activeSheetId, activeBranch]);

  const handleDismissConflict = useCallback((change: RemoteChange) => {
    setRemoteChanges((prev) =>
      prev.filter(
        (c) => !(c.collection === change.collection && c.rkey === change.rkey),
      ),
    );
  }, []);

  const handleDismissAllConflicts = useCallback(() => {
    setRemoteChanges([]);
  }, []);

  const handleSelectBranch = useCallback(
    async (sheetId: SheetId, branch: Branch | null) => {
      latestCommitRef.current = null;
      if (!branch || branch.name === 'main') {
        setActiveBranch(branch);
        branchBaseSheet.current = null;
        branchOriginalBase.current = null;
        setBranchCommits([]);
        if (preBranchFile.current) {
          setActiveFile(preBranchFile.current);
          preBranchFile.current = null;
        }
        return;
      }
      try {
        const cs = await fetchCommitsForBranch(branch.uri);
        // refs を先に確定させてから state を一括更新する。
        // こうすることで setActiveBranch により key が変わり GraphEditor がリマウントされる時点で
        // displaySheet が正しい branch 状態として計算される。
        const sheet = activeFile?.sheets.find((s) => s.id === sheetId) ?? null;
        branchBaseSheet.current = sheet;
        // 初回のみ trunk state を記憶: trunk↔branch を行き来しても diff 基点を保持する
        const storedBase = branchOriginalBaseMap.current.get(branch.uri);
        branchOriginalBase.current = storedBase ?? sheet;
        if (!storedBase && sheet) {
          branchOriginalBaseMap.current.set(branch.uri, sheet);
        }
        preBranchFile.current = activeFile ?? null;
        if (cs.length > 0) {
          const last = cs[cs.length - 1];
          latestCommitRef.current = { uri: last.uri, cid: last.cid };
        }
        setBranchCommits(cs);
        setBranchBaseVersion((v) => v + 1);
        setActiveBranch(branch); // 最後に呼ぶことで displaySheet 確定後に key が変わる
      } catch (err) {
        console.warn('[branch] fetch commits failed:', err);
      }
    },
    [activeFile],
  );

  const handleSelectSheet = useCallback((sheetId: SheetId) => {
    setActiveSheetId(sheetId);
    setActiveBranch(null);
    branchBaseSheet.current = null;
    branchOriginalBase.current = null;
    setBranchCommits([]);
    // branch 開始前の activeFile を復元 (branch の編集内容は永続化されないため)
    if (preBranchFile.current) {
      setActiveFile(preBranchFile.current);
      preBranchFile.current = null;
    }
  }, []);

  const handleCreateBranch = useCallback(async (sheetId: SheetId) => {
    const name = window.prompt('branch 名を入力してください:');
    if (!name?.trim()) return;
    try {
      const sheetRef = await sheets.ref(sheetId);
      const branch = await createBranch(
        name.trim(),
        sheetId,
        sheetRef,
        latestCommitRef.current ?? undefined,
      );
      setSheetBranches((prev) => {
        const next = new Map(prev);
        const existing = next.get(sheetId) ?? [];
        next.set(sheetId, [...existing, branch]);
        return next;
      });
    } catch (err) {
      console.warn('[branch] create failed:', err);
      alert(
        'branch の作成に失敗しました。ATProto にログインしているか確認してください。',
      );
    }
  }, []);

  const handleCommit = useCallback(
    async (message: string) => {
      if (!activeBranch || !activeSheetId || !activeFile) return;
      const ops = pendingOps;
      if (ops.length === 0) return;

      try {
        const sheetRef = await sheets.ref(activeSheetId);
        const branchRef = { uri: activeBranch.uri, cid: activeBranch.cid };
        const parentRef = latestCommitRef.current ?? undefined;

        const commit = await createCommit(
          message,
          ops,
          sheetRef,
          branchRef,
          parentRef,
        );
        setBranchCommits((prev) => [...prev, commit]);
        latestCommitRef.current = { uri: commit.uri, cid: commit.cid };

        // base state を更新 (次の commit の base)
        branchBaseSheet.current =
          activeFile.sheets.find((s) => s.id === activeSheetId) ?? null;
        setBranchBaseVersion((v) => v + 1);
        setCommitDialogOpen(false);
      } catch (err) {
        console.warn('[commit] create failed:', err);
        alert('コミットに失敗しました。');
      }
    },
    [activeBranch, activeSheetId, activeFile, pendingOps],
  );

  const handleClose = useCallback(async () => {
    if (!activeBranch || !activeSheetId) return;
    try {
      await updateBranchStatus(activeBranch, 'closed');
      setSheetBranches((prev) => {
        const next = new Map(prev);
        const existing = next.get(activeSheetId) ?? [];
        next.set(
          activeSheetId,
          existing.map((b) =>
            b.id === activeBranch.id ? { ...b, status: 'closed' as const } : b,
          ),
        );
        return next;
      });
      // trunk に戻る
      setActiveBranch(null);
      branchBaseSheet.current = null;
      branchOriginalBase.current = null;
      setBranchCommits([]);
      if (preBranchFile.current) {
        setActiveFile(preBranchFile.current);
        preBranchFile.current = null;
      }
    } catch (err) {
      console.warn('[close] failed:', err);
      alert('クローズに失敗しました。');
    }
  }, [activeBranch, activeSheetId]);

  const handleDeleteBranch = useCallback(
    async (sheetId: SheetId, branch: Branch) => {
      try {
        const branchCommitsList = await fetchCommitsForBranch(branch.uri);

        // 他の branch がこの branch の commit を参照していないか確認
        const allBranchesForSheet = sheetBranches.get(sheetId) ?? [];
        const branchCommitUris = new Set(branchCommitsList.map((c) => c.uri));
        const hasDependents = allBranchesForSheet.some(
          (b) =>
            b.id !== branch.id &&
            b.baseCommitUri &&
            branchCommitUris.has(b.baseCommitUri),
        );
        if (hasDependents) {
          alert(
            'このブランチを参照している他のブランチがあるため, 削除できません。',
          );
          return;
        }

        const hasPendingChanges =
          activeBranch?.id === branch.id && pendingOps.length > 0;

        setDeleteBranchState({
          sheetId,
          branch,
          commits: branchCommitsList,
          hasPendingChanges,
        });
      } catch (err) {
        console.warn('[delete branch] fetch commits failed:', err);
        alert('branch の情報取得に失敗しました。');
      }
    },
    [sheetBranches, activeBranch, pendingOps],
  );

  const handleConfirmDeleteBranch = useCallback(async () => {
    if (!deleteBranchState) return;
    const { sheetId, branch } = deleteBranchState;

    try {
      await deleteBranchFromPds(branch);

      // active branch だった場合は trunk に戻す
      if (activeBranch?.id === branch.id) {
        setActiveBranch(null);
        branchBaseSheet.current = null;
        branchOriginalBase.current = null;
        setBranchCommits([]);
        if (preBranchFile.current) {
          setActiveFile(preBranchFile.current);
          preBranchFile.current = null;
        }
      }

      setSheetBranches((prev) => {
        const next = new Map(prev);
        const existing = next.get(sheetId) ?? [];
        next.set(
          sheetId,
          existing.filter((b) => b.id !== branch.id),
        );
        return next;
      });

      setDeleteBranchState(null);
    } catch (err) {
      console.warn('[delete branch] failed:', err);
      alert('branch の削除に失敗しました。');
    }
  }, [deleteBranchState, activeBranch]);

  useEffect(() => {
    fetchFiles().then(setFiles).catch(console.error);
    // ATProto: ログイン後に CID キャッシュを初期化してポーリング開始
    tryAtprotoAutoLogin().then(async () => {
      try {
        // ATProto のファイル一覧を取得してローカル一覧とマージ
        const atprotoFiles = await fetchFilesFromAtproto();
        setFiles((local) => {
          const localIds = new Set(local.map((f) => f.id));
          const newFromAtproto = atprotoFiles.filter(
            (f) => !localIds.has(f.id),
          );
          // ATProto 側の情報で既存エントリを上書き (name/description が最新)
          const updated = local.map(
            (f) => atprotoFiles.find((a) => a.id === f.id) ?? f,
          );
          return [...updated, ...newFromAtproto];
        });
        await initCidCacheFromPds();
        startPolling((changes) => {
          console.info('[atproto] remote changes detected:', changes);
          // 同一 collection/rkey は最新値で上書き (重複キー警告を防ぎ, 最新状態を保持)
          setRemoteChanges((prev) => {
            const merged = [...prev];
            for (const change of changes) {
              const idx = merged.findIndex(
                (c) =>
                  c.collection === change.collection && c.rkey === change.rkey,
              );
              if (idx >= 0) {
                merged[idx] = change;
              } else {
                merged.push(change);
              }
            }
            return merged;
          });
        });
      } catch {
        // ATProto 未設定時はサイレントにスキップ
      }
    });
    return () => stopPolling();
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

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

  const openFile = useCallback(async (id: string) => {
    try {
      let file: GraphFile;
      try {
        // ATProto が primary
        file = await fetchFileFromAtproto(id);
        // ローカルキャッシュを非同期で更新
        saveFile(file).catch(() => {});
      } catch {
        // ATProto 未ログイン / オフライン時はローカルにフォールバック
        file = await fetchFile(id);
      }
      setActiveFile(file);
      setActiveSheetId((file.sheets[0]?.id ?? null) as SheetId | null);
      setExpandedFileIds((prev) => new Set([...prev, id]));
    } catch (err) {
      console.error('Failed to open file:', err);
    }
  }, []);

  const toggleExpand = useCallback(
    (id: string) => {
      setExpandedFileIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
          if (!activeFile || activeFile.id !== id) {
            openFile(id);
          }
        }
        return next;
      });
    },
    [activeFile, openFile],
  );

  const handleCreate = useCallback(async () => {
    try {
      const name = newFileName.trim() || '無題';
      const file = await createFile(name);
      setFiles((fs) => [
        ...fs,
        { id: file.id, name: file.name, description: file.description },
      ]);
      setActiveFile(file);
      setActiveSheetId((file.sheets[0]?.id ?? null) as SheetId | null);
      setExpandedFileIds((prev) => new Set([...prev, file.id]));
      setNewFileName('');
    } catch (err) {
      console.error('Failed to create file:', err);
    }
  }, [newFileName]);

  const persistFile = useCallback(async (updated: GraphFile) => {
    setActiveFile(updated);
    setFiles((fs) =>
      fs.map((f) =>
        f.id === updated.id
          ? {
              id: updated.id,
              name: updated.name,
              description: updated.description,
            }
          : f,
      ),
    );
    // ATProto が primary: 先に書き込む (ログイン済みの場合)
    try {
      await syncFileToAtproto(updated);
    } catch (err) {
      console.warn('[atproto] sync failed (falling back to local):', err);
    }
    // ローカル JSON はキャッシュ: 失敗してもサイレント
    saveFile(updated).catch((err) =>
      console.warn('[cache] local save failed:', err),
    );
  }, []);

  const handleMerge = useCallback(async () => {
    if (!activeBranch || !activeSheetId) return;
    const trunkFile = preBranchFile.current;
    const trunkSheet = trunkFile?.sheets.find((s) => s.id === activeSheetId);
    if (!trunkSheet || !trunkFile) return;

    const allOps = branchCommits.flatMap((c) => c.operations);
    const mergedSheet = applyOperations(trunkSheet, allOps);
    const mergedFile: GraphFile = {
      ...trunkFile,
      sheets: trunkFile.sheets.map((s) =>
        s.id === activeSheetId ? mergedSheet : s,
      ),
    };

    try {
      await persistFile(mergedFile);
      preBranchFile.current = mergedFile;

      const sheetRef = await sheets.ref(activeSheetId);
      const branchRef = { uri: activeBranch.uri, cid: activeBranch.cid };
      await createMergeRecord(
        activeBranch,
        sheetRef,
        branchRef,
        latestCommitRef.current ?? undefined,
      );

      const updatedBranch = await updateBranchStatus(activeBranch, 'merged');
      setActiveBranch(updatedBranch);
      setSheetBranches((prev) => {
        const next = new Map(prev);
        const existing = next.get(activeSheetId) ?? [];
        next.set(
          activeSheetId,
          existing.map((b) => (b.id === activeBranch.id ? updatedBranch : b)),
        );
        return next;
      });
      setMergeDialogOpen(false);
    } catch (err) {
      console.warn('[merge] failed:', err);
      alert('マージに失敗しました。');
    }
  }, [activeBranch, activeSheetId, branchCommits, persistFile]);

  const handleChange = useCallback(
    (updated: GraphFile) => {
      setActiveFile(updated);
      // branch モード中は永続化しない (branch の編集は commit 時のみ ATProto に書き込む)
      if (activeBranch && activeBranch.name !== 'main') return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(
        () => persistFile(updated),
        AUTOSAVE_DELAY,
      );
    },
    [persistFile, activeBranch],
  );

  const handleSaveFileSettings = useCallback(
    async (fileId: string, name: string, description: string) => {
      if (!activeFile || activeFile.id !== fileId) return;
      await persistFile({
        ...activeFile,
        name,
        description: description || undefined,
      });
    },
    [activeFile, persistFile],
  );

  const handleDeleteFile = useCallback(
    async (id: string) => {
      const target = files.find((f) => f.id === id);
      if (
        target &&
        !window.confirm(
          `「${target.name}」を削除しますか？\nシートも全て削除されます。`,
        )
      )
        return;
      try {
        await removeFile(id);
        try {
          await atprotoFilesColl.delete(id);
        } catch (err) {
          console.warn('[atproto] file delete failed:', err);
        }
        setFiles((fs) => fs.filter((f) => f.id !== id));
        if (activeFile?.id === id) {
          setActiveFile(null);
          setActiveSheetId(null);
        }
        setExpandedFileIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        setPopupTarget(null);
      } catch (err) {
        console.error('Failed to delete file:', err);
      }
    },
    [activeFile, files],
  );

  const handleSaveSheetSettings = useCallback(
    async (sheetId: string, name: string, description: string) => {
      if (!activeFile) return;
      await persistFile({
        ...activeFile,
        sheets: activeFile.sheets.map((s) =>
          s.id === sheetId
            ? { ...s, name, description: description || undefined }
            : s,
        ),
      });
    },
    [activeFile, persistFile],
  );

  const handleDeleteSheet = useCallback(
    async (sheetId: string) => {
      if (!activeFile) return;
      if (activeFile.sheets.length <= 1) {
        alert('最後のシートは削除できません');
        return;
      }
      const updated: GraphFile = {
        ...activeFile,
        sheets: activeFile.sheets.filter((s) => s.id !== sheetId),
      };
      if (activeSheetId === sheetId) {
        setActiveSheetId((updated.sheets[0]?.id ?? null) as SheetId | null);
      }
      setPopupTarget(null);
      await persistFile(updated);
    },
    [activeFile, activeSheetId, persistFile],
  );

  const handleImportFile = useCallback(async (data: ConversensusFile) => {
    try {
      const file = await importFile(data);
      setFiles((fs) => [
        ...fs,
        { id: file.id, name: file.name, description: file.description },
      ]);
      setActiveFile(file);
      setActiveSheetId((file.sheets[0]?.id ?? null) as SheetId | null);
      setExpandedFileIds((prev) => new Set([...prev, file.id]));
    } catch (err) {
      console.error('Failed to import file:', err);
      alert('インポートに失敗しました。ファイル形式を確認してください。');
    }
  }, []);

  const handleExportFile = useCallback(
    async (fileId: string) => {
      try {
        const file =
          activeFile?.id === fileId ? activeFile : await fetchFile(fileId);
        exportFile(file);
      } catch (err) {
        console.error('Failed to export file:', err);
      }
    },
    [activeFile],
  );

  const handleAddSheet = useCallback(async () => {
    if (!activeFile) return;
    const newSheet: Sheet = {
      id: crypto.randomUUID() as SheetId,
      name: `Sheet ${activeFile.sheets.length + 1}`,
      nodes: [],
      edges: [],
    };
    const updated: GraphFile = {
      ...activeFile,
      sheets: [...activeFile.sheets, newSheet],
    };
    setActiveSheetId(newSheet.id);
    await persistFile(updated);
  }, [activeFile, persistFile]);

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif' }}>
      <Sidebar
        files={files}
        activeFile={activeFile}
        activeSheetId={activeSheetId}
        expandedFileIds={expandedFileIds}
        newFileName={newFileName}
        popupTarget={popupTarget}
        onNewFileNameChange={setNewFileName}
        onCreateFile={handleCreate}
        onImportFile={handleImportFile}
        onToggleExpand={toggleExpand}
        onOpenFile={openFile}
        onSelectSheet={handleSelectSheet}
        onAddSheet={handleAddSheet}
        onSetPopupTarget={setPopupTarget}
        onSaveFileSettings={handleSaveFileSettings}
        onDeleteFile={handleDeleteFile}
        onExportFile={handleExportFile}
        onSaveSheetSettings={handleSaveSheetSettings}
        onDeleteSheet={handleDeleteSheet}
        sheetBranches={sheetBranches}
        activeBranchId={activeBranch?.id ?? null}
        onSelectBranch={handleSelectBranch}
        onCreateBranch={handleCreateBranch}
        onDeleteBranch={handleDeleteBranch}
      />
      <main style={{ flex: 1 }}>
        {activeFile && activeSheetId ? (
          <GraphEditor
            key={`${activeSheetId}/${activeBranch?.id ?? 'trunk'}`}
            file={displayFile ?? activeFile}
            activeSheetId={activeSheetId}
            onChange={handleChange}
            conflictedNodeIds={conflictedNodeIds}
            conflictedEdgeIds={conflictedEdgeIds}
          />
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#999',
            }}
          >
            ファイルを選択するか, 新規作成してください
          </div>
        )}
      </main>
      <ConflictPanel
        changes={remoteChanges}
        onDismiss={handleDismissConflict}
        onDismissAll={handleDismissAllConflicts}
      />
      {activeBranch && activeBranch.name !== 'main' && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 100,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <span
            style={{
              fontSize: 12,
              color: '#555',
              background: '#fff',
              padding: '4px 8px',
              borderRadius: 4,
              border: '1px solid #ddd',
            }}
          >
            ⎇ {activeBranch.name}{' '}
            {pendingOps.length > 0 ? `(${pendingOps.length} 変更)` : ''}
          </span>
          {(() => {
            const canCommit =
              pendingOps.length > 0 && activeBranch.status === 'open';
            const canMerge =
              pendingOps.length === 0 &&
              branchCommits.length > 0 &&
              activeBranch.status === 'open';
            const canClose = activeBranch.status === 'merged';
            return (
              <>
                <button
                  type="button"
                  onClick={() => setCommitDialogOpen(true)}
                  disabled={!canCommit}
                  style={{
                    padding: '6px 16px',
                    fontSize: 13,
                    background: canCommit ? '#4f6ef7' : '#ccc',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 4,
                    cursor: canCommit ? 'pointer' : 'not-allowed',
                  }}
                >
                  コミット
                </button>
                <button
                  type="button"
                  onClick={() => setMergeDialogOpen(true)}
                  disabled={!canMerge}
                  style={{
                    padding: '6px 16px',
                    fontSize: 13,
                    background: canMerge ? '#e67e22' : '#ccc',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 4,
                    cursor: canMerge ? 'pointer' : 'not-allowed',
                  }}
                >
                  マージ
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={!canClose}
                  style={{
                    padding: '6px 16px',
                    fontSize: 13,
                    background: canClose ? '#555' : '#ccc',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 4,
                    cursor: canClose ? 'pointer' : 'not-allowed',
                  }}
                >
                  クローズ
                </button>
              </>
            );
          })()}
        </div>
      )}
      {commitDialogOpen && (
        <CommitDialog
          operations={pendingOps}
          onCommit={handleCommit}
          onCancel={() => setCommitDialogOpen(false)}
        />
      )}
      {mergeDialogOpen && activeBranch && (
        <MergeDialog
          branch={activeBranch}
          commits={branchCommits}
          onConfirm={handleMerge}
          onCancel={() => setMergeDialogOpen(false)}
        />
      )}
      {deleteBranchState && (
        <BranchDeleteDialog
          branch={deleteBranchState.branch}
          commits={deleteBranchState.commits}
          hasPendingChanges={deleteBranchState.hasPendingChanges}
          onConfirm={handleConfirmDeleteBranch}
          onCancel={() => setDeleteBranchState(null)}
        />
      )}
    </div>
  );
}
