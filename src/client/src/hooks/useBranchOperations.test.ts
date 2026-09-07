import { afterEach, describe, expect, it, mock } from 'bun:test';
import type {
  BranchMeta,
  CommitOperation,
  FileId,
  GraphFile,
  NodeId,
  SheetId,
} from '@conversensus/shared';
import {
  createInMemoryBranchOplogDeps,
  createInMemoryBranchOpsDeps,
} from './testing/inMemoryDeps';
import type {
  AlertState,
  ConfirmState,
  InputState,
} from './useBranchOperations';

const { renderHook, act, cleanup } = await import('@testing-library/react');
const {
  BRANCH_DIFF_STATE,
  defaultBranchOpsDeps,
  resolveBranchDiffState,
  useBranchOperations,
} = await import('./useBranchOperations');
const { LamportClock } = await import('@conversensus/shared');

/** merge の再スタンプ用 clock。本番では trunk の tap のものを渡す */
const makeClock = () => {
  const clock = new LamportClock();
  return {
    seed: (floor: number) => {
      clock.seed(floor);
    },
    tick: () => clock.tick(),
  };
};

// ダイアログの差し込み口。**引数の形を本物に合わせる** — ここを () => {} のままに
// すると、mockImplementationOnce で resolve を呼ぶ側の型も検査されなくなる
const mockOnSetActiveFile = mock((_file: GraphFile | null) => {});
const mockSetConfirmState = mock((_s: ConfirmState | null) => {});
const mockSetInputState = mock((_s: InputState | null) => {});
const mockSetAlertState = mock((_s: AlertState | null) => {});

const mockActiveFile: GraphFile = {
  id: 'f1' as FileId,
  name: 'test',
  description: '',
  sheets: [{ id: 's1' as SheetId, name: 'Sheet 1', nodes: [], edges: [] }],
};
const mockActiveSheet = {
  id: 's1' as SheetId,
  name: 'Sheet 1',
  nodes: [],
  edges: [],
};

afterEach(() => {
  cleanup();
  mockOnSetActiveFile.mockClear();
  mockSetConfirmState.mockClear();
  mockSetInputState.mockClear();
  mockSetAlertState.mockClear();
});
// --- テストの共通ハーネス ---

const TRUNK_ID = 'f1' as FileId;
const SHEET_ID = 's1' as SheetId;

/** trunk op-log の 1 batch (content, sheetId 付き) */
const trunkBatch = (id: string, clock: number, nodeId: string, text: string) =>
  ({
    id,
    actor: 'seed#dev',
    clock,
    timestamp: clock,
    sheetId: SHEET_ID,
    ops: [{ kind: 'node.add', target: nodeId, content: text }],
    // biome-ignore lint/suspicious/noExplicitAny: テストの最小 Batch (branded 型は実行時に無関係)
  }) as any;

/** trunk op-log でノードを 1 つ消す batch (削除依存の競合を作る用) */
const trunkRemoveBatch = (id: string, clock: number, nodeId: string) =>
  ({
    id,
    actor: 'seed#dev',
    clock,
    timestamp: clock,
    sheetId: SHEET_ID,
    ops: [{ kind: 'node.remove', target: nodeId }],
    // biome-ignore lint/suspicious/noExplicitAny: テストの最小 Batch (branded 型は実行時に無関係)
  }) as any;

// `graphEventToBatch` は API 境界と同じ zod 検証を通すので、id は実 UUID 形式で作る
let uuidSeq = 0;
const uuid = () => {
  uuidSeq += 1;
  return `${uuidSeq.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
};

/**
 * node.setContent を 1 件生む content イベント。
 * `nodeId` を渡せるのは**対立を作るため** — 既定の新しい id では trunk 側と衝突しない
 */
const relabel = (to: string, nodeId: string = uuid()) => ({
  id: uuid(),
  timestamp: 1,
  category: 'content' as const,
  type: 'NODE_RELABELED' as const,
  // biome-ignore lint/suspicious/noExplicitAny: branded NodeId をテストで作らない
  nodeId: nodeId as any,
  from: '',
  to,
});

/** 確認ダイアログに答える。`ok=false` はキャンセル */
const answerMergeConfirm = (ok: boolean) => {
  mockSetConfirmState.mockImplementationOnce((s) => {
    s?.resolve(ok);
  });
};

async function renderOplog(
  trunkLog = [trunkBatch('t1', 3, 'n1', 'trunk')],
  options: {
    slowBranchPush?: boolean;
    /**
     * 差分計算を本物にする (差分状態のテスト用)。スタブは基準に関わらず同じ配列を
     * 返すので、**どの Sheet を起点にしたか**を区別できない。
     */
    realChanges?: boolean;
    /**
     * 既存の op-log ストアを引き継いで hook を作り直す = **アプリを開き直す**。
     * React の ref や state は消えるが、ログに書いたものは残る (ANA-119 S6 の検証用)。
     */
    reuse?: ReturnType<typeof createInMemoryBranchOplogDeps>;
  } = {},
) {
  const deps = createInMemoryBranchOpsDeps();
  const oplogDeps = options.reuse ?? createInMemoryBranchOplogDeps();
  if (!options.reuse) oplogDeps._batches.set(TRUNK_ID, trunkLog);
  if (options.slowBranchPush) {
    // branch tap の push を遅らせ、「record 直後に commit/merge」を再現する。
    // tap の flush は非同期なので、待たない実装ではこの窓で編集を取りこぼす。
    const base = oplogDeps.createBranchProvider;
    oplogDeps.createBranchProvider = (fileId) => {
      const provider = base?.(fileId);
      if (!provider) throw new Error('provider が要る');
      return {
        ...provider,
        push: async (batches) => {
          await new Promise((r) => setTimeout(r, 30));
          await provider.push(batches);
        },
      };
    };
  }
  const clock = makeClock();
  const view = renderHook(
    ({ activeFile, activeSheetId, activeSheet }) =>
      useBranchOperations({
        activeFile,
        activeSheetId: activeSheetId ?? null,
        activeSheet: activeSheet ?? null,
        onSetActiveFile: mockOnSetActiveFile,
        setConfirmState: mockSetConfirmState,
        setInputState: mockSetInputState,
        setAlertState: mockSetAlertState,
        deps: options.realChanges ? defaultBranchOpsDeps : deps,
        oplogDeps,
        actor: 'did:plc:alice#dev1',
        trunkClock: clock,
      }),
    {
      initialProps: {
        activeFile: mockActiveFile,
        activeSheetId: SHEET_ID,
        activeSheet: mockActiveSheet,
      },
    },
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
  return { ...view, deps, oplogDeps };
}

/**
 * branch を 1 つ作って選択済みにする (以降のテストの共通前提)。
 *
 * `pending` は「表示上の未コミット変更」— `pendingChanges` は `computeOperations` の
 * useMemo なので、**branch を選ぶ前**に仕込まないと再計算の契機が来ない。
 */
async function withOpenBranch(
  trunkLog?: Parameters<typeof renderOplog>[0],
  // biome-ignore lint/suspicious/noExplicitAny: computeOperations の戻り値はテストでは形だけ
  pending: any[] = [],
  options: Parameters<typeof renderOplog>[1] = {},
) {
  const view = await renderOplog(trunkLog, options);
  view.deps._setComputeOps(pending);
  mockSetInputState.mockImplementationOnce((s) => {
    s?.resolve('feature-x');
  });
  await act(async () => {
    await view.result.current.handleCreateBranch(SHEET_ID);
  });
  const branch = (view.result.current.sheetBranches.get(SHEET_ID) ??
    ([] as BranchMeta[]))[0] as BranchMeta;
  await act(async () => {
    await view.result.current.handleSelectBranch(SHEET_ID, branch);
  });
  return { ...view, branch };
}
/**
 * merge 理由の入力に答える (ANA-122)。merge は理由が必須なので、
 * **答えないと入力の Promise が解決せず merge に進まない**。
 * 空白だけを渡せば入力ダイアログのキャンセルと同じ扱いになる。
 */
const answerMergeReason = (reason: string) => {
  mockSetInputState.mockImplementationOnce((s) => {
    s?.resolve(reason);
  });
};

/** 指定 status に付け替えた branch を選び直す (状態ゲートの検証用) */
async function selectWithStatus(
  view: Awaited<ReturnType<typeof withOpenBranch>>,
  status: 'open' | 'merged' | 'closed',
) {
  const meta = await view.oplogDeps.saveBranch({ ...view.branch, status });
  await act(async () => {
    await view.result.current.handleSelectBranch(SHEET_ID, meta);
  });
}

describe('useBranchOperations — 表示状態', () => {
  describe('initial state', () => {
    it('activeBranch が null', async () => {
      const { result } = await renderOplog();
      expect(result.current.activeBranch).toBeNull();
    });

    it('isTrunk が true', async () => {
      const { result } = await renderOplog();
      expect(result.current.isTrunk).toBe(true);
    });

    it('pendingChanges が空配列', async () => {
      const { result } = await renderOplog();
      expect(result.current.pendingChanges).toEqual([]);
    });

    it('newCommitsSinceMerge が 0', async () => {
      const { result } = await renderOplog();
      expect(result.current.newCommitsSinceMerge).toBe(0);
    });

    it('commitDialogOpen が false', async () => {
      const { result } = await renderOplog();
      expect(result.current.commitDialogOpen).toBe(false);
    });

    it('diff 関連の Set が空', async () => {
      const { result } = await renderOplog();
      expect(result.current.addedNodeIds.size).toBe(0);
      expect(result.current.addedEdgeIds.size).toBe(0);
    });

    it('sheetBranches の active sheet に対応する branches は空', async () => {
      const { result } = await renderOplog();
      expect((result.current.sheetBranches.get(SHEET_ID) ?? []).length).toBe(0);
    });
  });

  describe('handleCreateBranch', () => {
    it('空の名前では作成されない', async () => {
      const { result } = await renderOplog();
      mockSetInputState.mockImplementationOnce((s) => {
        s?.resolve('');
      });
      await act(async () => {
        await result.current.handleCreateBranch(SHEET_ID);
      });
      expect((result.current.sheetBranches.get(SHEET_ID) ?? []).length).toBe(0);
    });
  });

  describe('handleCommit', () => {
    it('activeBranch が null の場合は早期 return', async () => {
      const { result } = await renderOplog();
      await act(async () => {
        await result.current.handleCommit('test message');
      });
      // エラーなく完了すること
      expect(result.current.commitDialogOpen).toBe(false);
    });
  });

  describe('resetBranchState', () => {
    it('全 branch 状態をリセットする', async () => {
      const { result } = await renderOplog();
      act(() => {
        result.current.resetBranchState();
      });
      expect(result.current.activeBranch).toBeNull();
      expect(result.current.isTrunk).toBe(true);
    });
  });

  /**
   * `pendingChanges` は「コミットできる変更があるか」= コミットボタンの有効/無効。
   * status ごとの出し分けを固定する — CLOSED の branch にコミットさせないため。
   */
  describe('pendingChanges (commit 可能な変更の検出)', () => {
    const ops: CommitOperation[] = [
      { op: 'node.add', nodeId: 'n1', content: 'hi' },
    ];

    it('OPEN branch で変更あり → pendingChanges に含まれる', async () => {
      const view = await withOpenBranch(undefined, ops);
      expect(view.result.current.pendingChanges.length).toBe(1);
    });

    it('MERGED branch で変更あり → pendingChanges に含まれる', async () => {
      const view = await withOpenBranch(undefined, ops);
      await selectWithStatus(view, 'merged');
      expect(view.result.current.pendingChanges.length).toBe(1);
    });

    it('CLOSED branch → pendingChanges 空', async () => {
      const view = await withOpenBranch(undefined, ops);
      await selectWithStatus(view, 'closed');
      expect(view.result.current.pendingChanges).toEqual([]);
    });

    it('isTrunk 時は pendingChanges 空', async () => {
      const view = await renderOplog();
      view.deps._setComputeOps(ops);
      expect(view.result.current.pendingChanges).toEqual([]);
    });
  });

  describe('deletedNodes / deletedEdges (ゴースト表示用)', () => {
    it('node.remove op → deletedNodes に含まれ、addedNodeIds に含まれない', async () => {
      const view = await withOpenBranch(undefined, [
        { op: 'node.remove', nodeId: 'n1' },
      ]);
      // base (branch 作成時点の projection) にある n1 がゴーストとして残る
      expect(
        view.result.current.deletedNodes.map((n) => n.id as string),
      ).toEqual(['n1']);
      // remove は conflicted (ハイライト) には入らない
      expect(view.result.current.addedNodeIds.size).toBe(0);
    });

    it('edge.remove op → addedEdgeIds に含まれない', async () => {
      const view = await withOpenBranch(undefined, [
        { op: 'edge.remove', edgeId: 'e1' },
      ]);
      expect(view.result.current.addedEdgeIds.has('e1')).toBe(false);
    });

    it('node.add op → addedNodeIds に含まれる', async () => {
      const view = await withOpenBranch(undefined, [
        { op: 'node.add', nodeId: 'n1', content: 'hi' },
      ]);
      expect(view.result.current.addedNodeIds.has('n1')).toBe(true);
    });
  });

  describe('File 切り替え時のリセット', () => {
    it('activeFile.id 変更 → activeBranch が null にリセット', async () => {
      const view = await withOpenBranch();
      expect(view.result.current.activeBranch).not.toBeNull();

      await act(async () => {
        view.rerender({
          activeFile: { ...mockActiveFile, id: 'f2' as FileId },
          activeSheetId: SHEET_ID,
          activeSheet: mockActiveSheet,
        });
        await new Promise((r) => setTimeout(r, 10));
      });

      expect(view.result.current.activeBranch).toBeNull();
    });
  });

  describe('setCommitDialogOpen', () => {
    it('commitDialogOpen を切り替えられる', async () => {
      const { result } = await renderOplog();
      act(() => {
        result.current.setCommitDialogOpen(true);
      });
      expect(result.current.commitDialogOpen).toBe(true);
      act(() => {
        result.current.setCommitDialogOpen(false);
      });
      expect(result.current.commitDialogOpen).toBe(false);
    });
  });
});

describe('useBranchOperations — branch 操作 (op-log)', () => {
  describe('handleCreateBranch', () => {
    it('分岐点だけを記録し trunk op-log は複製しない', async () => {
      // 旧経路は trunk の全レコードを `{branchId}_` prefix で PDS へ複製していた。
      // op-log では base コミット (ログ上のオフセット) を記録するだけでよい。
      const { result, oplogDeps } = await renderOplog();
      mockSetInputState.mockImplementationOnce((s) => {
        s?.resolve('feature-x');
      });
      await act(async () => {
        await result.current.handleCreateBranch(SHEET_ID);
      });

      const branches = result.current.sheetBranches.get(SHEET_ID) ?? [];
      expect(branches).toHaveLength(1);
      const meta = branches[0] as BranchMeta;
      expect(meta.name).toBe('feature-x');
      // base は現在のログ先端 (tipClock)
      expect(meta.base.at).toBe(3);
      expect(meta.trunkFileId).toBe(TRUNK_ID);
      // trunk は 1 件も増えず、branch 専用 op-log も空のまま (複製しない)
      expect(oplogDeps._batches.get(TRUNK_ID)).toHaveLength(1);
      expect(oplogDeps._batches.get(meta.branchFileId) ?? []).toHaveLength(0);
    });
  });

  describe('handleSelectBranch', () => {
    it('branch のシート内容を projection から差し替える', async () => {
      const { branch, oplogDeps } = await withOpenBranch();
      // 分岐直後は base = trunk の内容
      const passed = mockOnSetActiveFile.mock.calls.at(-1)?.[0];
      const sheet = passed?.sheets.find((s) => s.id === SHEET_ID);
      expect(sheet?.nodes.map((n) => n.content)).toEqual(['trunk']);
      expect(oplogDeps._branches.get(branch.id)?.status).toBe('open');
    });

    it('trunk に戻ると分岐前のファイルへ復帰する', async () => {
      const { result } = await withOpenBranch();
      await act(async () => {
        await result.current.handleSelectBranch(SHEET_ID, null);
      });
      expect(result.current.activeBranch).toBeNull();
      expect(result.current.isTrunk).toBe(true);
      expect(mockOnSetActiveFile.mock.calls.at(-1)?.[0]).toEqual(
        mockActiveFile,
      );
    });

    it('resetBranchState は復帰した trunk のファイルを返す', async () => {
      // 呼び出し側 (App のシート追加) が **trunk のファイルを土台に**続けるための返り値。
      // branch 表示中の activeFile を土台にすると branch の内容が trunk へ移る。
      const { result } = await withOpenBranch();
      let restored: unknown;
      act(() => {
        restored = result.current.resetBranchState();
      });
      expect(restored).toEqual(mockActiveFile);
      expect(result.current.isTrunk).toBe(true);
    });
  });

  describe('branch 編集の宛先 (載せ替えの要)', () => {
    it('branch 表示中の編集は branch 専用 op-log にだけ積まれる', async () => {
      // 🔴 これが p5-4 の核心。旧配線では branch 表示中の編集も trunk の tap へ流れ、
      // branch の編集が trunk のログを汚していた。
      const { result, branch, oplogDeps } = await withOpenBranch();
      const record = result.current.branchSyncRecord;
      expect(record).not.toBeNull();
      await act(async () => {
        record?.(relabel('branch の編集'), SHEET_ID);
        await new Promise((r) => setTimeout(r, 10));
      });

      expect(oplogDeps._batches.get(TRUNK_ID)).toHaveLength(1); // trunk 不変
      const branchLog = oplogDeps._batches.get(branch.branchFileId) ?? [];
      expect(branchLog).toHaveLength(1);
      expect(branchLog[0]?.actor).toBe('did:plc:alice#dev1');
    });

    it('branch の発番は分岐点の後から始まる (clockFloor)', async () => {
      // 空の branch op-log から 1 で発番を始めると、base 時点の trunk batch
      // (clock 3) に LWW で負ける。
      const { result, branch, oplogDeps } = await withOpenBranch();
      await act(async () => {
        result.current.branchSyncRecord?.(relabel('上書き'), SHEET_ID);
        await new Promise((r) => setTimeout(r, 10));
      });
      const branchLog = oplogDeps._batches.get(branch.branchFileId) ?? [];
      expect(branchLog[0]?.clock).toBeGreaterThan(branch.base.at);
    });

    it('trunk 表示中は branchSyncRecord が null (trunk 用 tap を使う)', async () => {
      const { result } = await renderOplog();
      expect(result.current.branchSyncRecord).toBeNull();
    });
  });

  describe('handleCommit', () => {
    it('コミットはログ上のオフセットとして保存される', async () => {
      // pendingChanges は diff 由来 (表示用) なので、変更ありの状態で選択させる
      const { result, branch, oplogDeps } = await withOpenBranch(undefined, [
        { op: 'node.update', nodeId: 'n1' },
      ]);
      await act(async () => {
        result.current.branchSyncRecord?.(relabel('編集'), SHEET_ID);
        await new Promise((r) => setTimeout(r, 10));
      });
      await act(async () => {
        await result.current.handleCommit('編集をコミット');
      });

      const commits = oplogDeps._commits.get(branch.branchFileId) ?? [];
      expect(commits).toHaveLength(1);
      // at = branch op-log の先端。差分そのものは持たない
      const branchLog = oplogDeps._batches.get(branch.branchFileId) ?? [];
      expect(commits[0]?.at).toBe(branchLog[0]?.clock);
      expect(commits[0]?.message).toBe('編集をコミット');
      expect(result.current.newCommitsSinceMerge).toBe(1);
    });

    it('🔴 直前の編集が着地するのを待ってからコミットする', async () => {
      // record は非同期に flush する。待たずに op-log を読むと、その編集が
      // コミット位置に入らず、再オープン時に未コミットとして復活する。
      const { result, branch, oplogDeps } = await withOpenBranch(
        undefined,
        [{ op: 'node.update', nodeId: 'n1' }],
        { slowBranchPush: true },
      );
      await act(async () => {
        result.current.branchSyncRecord?.(relabel('編集'), SHEET_ID);
        // 待たずに続けてコミットする (push はまだ飛んでいない)
        await result.current.handleCommit('直後のコミット');
      });

      const branchLog = oplogDeps._batches.get(branch.branchFileId) ?? [];
      const commits = oplogDeps._commits.get(branch.branchFileId) ?? [];
      expect(branchLog).toHaveLength(1);
      expect(commits[0]?.at).toBe(branchLog[0]?.clock as number);
    });

    it('変更が無ければコミットしない', async () => {
      const { result, branch, oplogDeps } = await withOpenBranch();
      await act(async () => {
        await result.current.handleCommit('空コミット');
      });
      expect(oplogDeps._commits.get(branch.branchFileId) ?? []).toHaveLength(0);
    });
  });

  describe('handleMergeBranch', () => {
    it('branch batches を trunk 先端の後へ再スタンプして追記する', async () => {
      const { result, branch, oplogDeps } = await withOpenBranch();
      await act(async () => {
        result.current.branchSyncRecord?.(relabel('branch の編集'), SHEET_ID);
        await new Promise((r) => setTimeout(r, 10));
      });
      const branchLog = oplogDeps._batches.get(branch.branchFileId) ?? [];
      const branchBatchId = branchLog[0]?.id;
      // merge 前に trunk が進んだ状況を作る (再スタンプの必要性が出る)
      oplogDeps._batches.set(TRUNK_ID, [
        ...(oplogDeps._batches.get(TRUNK_ID) ?? []),
        trunkBatch('t2', 9, 'n2', 'trunk の後発編集'),
      ]);

      answerMergeReason('取り込む');
      await act(async () => {
        await result.current.handleMergeBranch(branch);
      });

      const trunkLog = oplogDeps._batches.get(TRUNK_ID) ?? [];
      const merged = trunkLog.find((b) => b.id === branchBatchId);
      // id は保持 (再 merge のべき等性)、clock は trunk 先端 (9) より後
      expect(merged).toBeDefined();
      expect(merged?.clock).toBeGreaterThan(9);
      expect(result.current.activeBranch?.status).toBe('merged');
    });

    /**
     * merge 理由は commit と同様に必須 (ANA-122)。空のまま進めると
     * 「いつ・誰が・何のために merge したか」が欠けた記録が残ってしまう。
     */
    it('理由を入力しなければ merge しない', async () => {
      const { result, branch, oplogDeps } = await withOpenBranch();
      answerMergeReason('   '); // 空白だけ = 入力ダイアログのキャンセルと同じ
      await act(async () => {
        await result.current.handleMergeBranch(branch);
      });
      expect(oplogDeps._batches.get(TRUNK_ID)).toHaveLength(1);
      expect(oplogDeps._branches.get(branch.id)?.status).toBe('open');
      expect(oplogDeps._commits.get(TRUNK_ID) ?? []).toHaveLength(0);
    });

    it('merge の記録が trunk 側の commits に kind=merge で残る', async () => {
      const { result, branch, oplogDeps } = await withOpenBranch();
      await act(async () => {
        result.current.branchSyncRecord?.(relabel('branch の編集'), SHEET_ID);
        await new Promise((r) => setTimeout(r, 10));
      });
      answerMergeReason('案 A を採用したため');
      await act(async () => {
        await result.current.handleMergeBranch(branch);
      });

      const commits = oplogDeps._commits.get(TRUNK_ID) ?? [];
      expect(commits).toHaveLength(1);
      expect(commits[0]?.kind).toBe('merge');
      expect(commits[0]?.message).toBe('案 A を採用したため');
      expect(commits[0]?.authorActor).toBe('did:plc:alice#dev1');
      expect(commits[0]?.sourceBranchId).toBe(branch.id);
    });

    /**
     * Phase 3 T1 の決着: **適用前に何が起きるかを見せる。**
     *
     * merge は不可逆である — 再スタンプした branch batches は trunk op-log へ追記され、
     * revert の経路が無い (branch が MERGED になるだけ)。人が押す操作なので、
     * 人の判断が要る対立 (content / structure) は取り込む前に問う。
     */
    describe('取り込む前の確認 (Phase 3 T1)', () => {
      /** trunk が消したノードを branch が編集した状態を作る (削除依存の対立) */
      async function conflictingBranch() {
        const node = uuid();
        const view = await withOpenBranch([trunkBatch('t1', 3, node, 'trunk')]);
        await act(async () => {
          view.result.current.branchSyncRecord?.(
            relabel('branch の編集', node),
            SHEET_ID,
          );
          await new Promise((r) => setTimeout(r, 10));
        });
        // 分岐後に trunk 側が同じノードを消す
        view.oplogDeps._batches.set(TRUNK_ID, [
          ...(view.oplogDeps._batches.get(TRUNK_ID) ?? []),
          trunkRemoveBatch('t2', 9, node),
        ]);
        // branch 作成が名前の入力を 1 回使っているので、ここから数え直す
        mockSetInputState.mockClear();
        return view;
      }

      it('🔴 対立があれば確認を出し、キャンセルすると trunk は動かない', async () => {
        const { result, branch, oplogDeps } = await conflictingBranch();
        const before = (oplogDeps._batches.get(TRUNK_ID) ?? []).length;

        answerMergeConfirm(false);
        await act(async () => {
          await result.current.handleMergeBranch(branch);
        });

        expect(mockSetConfirmState).toHaveBeenCalledTimes(1);
        expect(mockSetConfirmState.mock.calls[0]?.[0]?.message).toContain(
          'structure 1 件',
        );
        // **1 件も載らない。**理由の入力にも進まない (押さなければ何も起きない)
        expect(oplogDeps._batches.get(TRUNK_ID) ?? []).toHaveLength(before);
        expect(oplogDeps._branches.get(branch.id)?.status).toBe('open');
        expect(oplogDeps._commits.get(TRUNK_ID) ?? []).toHaveLength(0);
        expect(mockSetInputState).not.toHaveBeenCalled();
      });

      it('確認を承諾すれば従来どおり merge される', async () => {
        const { result, branch, oplogDeps } = await conflictingBranch();
        const before = (oplogDeps._batches.get(TRUNK_ID) ?? []).length;

        answerMergeConfirm(true);
        answerMergeReason('対立を承知で取り込む');
        await act(async () => {
          await result.current.handleMergeBranch(branch);
        });

        expect((oplogDeps._batches.get(TRUNK_ID) ?? []).length).toBeGreaterThan(
          before,
        );
        expect(oplogDeps._branches.get(branch.id)?.status).toBe('merged');
        expect(oplogDeps._commits.get(TRUNK_ID) ?? []).toHaveLength(1);
      });

      it('対立が無ければ確認は出ない (理由の入力が唯一の確認)', async () => {
        // 見せるものが無いのに二段構えにしても得るものが無い、という既存の判断を保つ
        const { result, branch, oplogDeps } = await withOpenBranch();
        await act(async () => {
          result.current.branchSyncRecord?.(relabel('branch の編集'), SHEET_ID);
          await new Promise((r) => setTimeout(r, 10));
        });

        answerMergeReason('取り込む');
        await act(async () => {
          await result.current.handleMergeBranch(branch);
        });

        expect(mockSetConfirmState).not.toHaveBeenCalled();
        expect(oplogDeps._branches.get(branch.id)?.status).toBe('merged');
      });
    });
  });

  describe('handleCloseBranch / handleDeleteBranch', () => {
    it('close は status を closed にする (op-log は残る)', async () => {
      const { result, branch, oplogDeps } = await withOpenBranch();
      mockSetConfirmState.mockImplementationOnce((s) => {
        s?.resolve(true);
      });
      await act(async () => {
        await result.current.handleCloseBranch(branch);
      });
      expect(oplogDeps._branches.get(branch.id)?.status).toBe('closed');
      expect(result.current.activeBranch).toBeNull();
    });

    it('delete はメタと branch 専用 op-log をまとめて消す', async () => {
      const { result, branch, oplogDeps } = await withOpenBranch();
      await act(async () => {
        result.current.branchSyncRecord?.(relabel('編集'), SHEET_ID);
        await new Promise((r) => setTimeout(r, 10));
      });
      mockSetConfirmState.mockImplementationOnce((s) => {
        s?.resolve(true);
      });
      await act(async () => {
        await result.current.handleDeleteBranch(branch);
      });
      expect(oplogDeps._branches.has(branch.id)).toBe(false);
      expect(oplogDeps._batches.has(branch.branchFileId)).toBe(false);
      expect(result.current.sheetBranches.get(SHEET_ID)).toEqual([]);
    });
  });
});

/**
 * 差分状態 (ANA-119/120 S3)。
 *
 * ここだけ差分計算を**本物**にしてある (`realChanges`)。スタブは基準に関わらず同じ配列を
 * 返すので、「どの Sheet を起点にしたか」= このスライスの検証対象そのものを区別できない。
 */
describe('useBranchOperations — 差分状態 (ANA-120)', () => {
  const NODE_A = 'a0000000-0000-4000-8000-000000000000' as NodeId;
  const NODE_B = 'b0000000-0000-4000-8000-000000000000' as NodeId;

  type View = Awaited<ReturnType<typeof withOpenBranch>>;
  // biome-ignore lint/suspicious/noExplicitAny: テストで branded 型の Sheet を組まない
  type TestSheet = any;

  /** hook が最後に渡してきた branch の projection */
  const projectedSheet = (): TestSheet => {
    const file = mockOnSetActiveFile.mock.calls.at(-1)?.[0];
    const sheet = file?.sheets.find((s) => s.id === SHEET_ID);
    if (!sheet) throw new Error('branch の projection が取れていない');
    return sheet;
  };

  /**
   * activeSheet を差し替える = 画面でシートを編集したのと同じ状態にする。
   * **`rerender` しか使わない**ので、branch を持たない view (開き直した直後) も受ける
   */
  async function edit(view: Pick<View, 'rerender'>, sheet: TestSheet) {
    await act(async () => {
      view.rerender({
        activeFile: mockActiveFile,
        activeSheetId: SHEET_ID,
        activeSheet: sheet,
      });
    });
  }

  const relabelNode = (sheet: TestSheet, id: string, content: string) => ({
    ...sheet,
    nodes: sheet.nodes.map((n: { id: string }) =>
      n.id === id ? { ...n, content } : n,
    ),
  });
  const addNode = (sheet: TestSheet, id: string) => ({
    ...sheet,
    nodes: [...sheet.nodes, { id, content: '新規' }],
  });
  const removeNode = (sheet: TestSheet, id: string) => ({
    ...sheet,
    nodes: sheet.nodes.filter((n: { id: string }) => n.id !== id),
  });

  /** 分岐点に NODE_A が 1 個だけある branch を開き、その projection を画面に載せる */
  async function openBranch() {
    const view = await withOpenBranch(
      [trunkBatch('t1', 3, NODE_A, 'trunk')],
      [],
      { realChanges: true },
    );
    const base = projectedSheet();
    await edit(view, base);
    return { view, base };
  }

  /** commit する (pendingChanges があること = 変更中であることが前提) */
  async function commit(view: Pick<View, 'result'>, message: string) {
    await act(async () => {
      await view.result.current.handleCommit(message);
    });
  }

  describe('状態の判定規則 (resolveBranchDiffState)', () => {
    it('trunk は常に trunk', () => {
      expect(resolveBranchDiffState(true, true, 3)).toBe(
        BRANCH_DIFF_STATE.TRUNK,
      );
    });

    it('未コミットの変更があれば変更中 (commit の有無に依らない)', () => {
      expect(resolveBranchDiffState(false, true, 0)).toBe(
        BRANCH_DIFF_STATE.EDITING,
      );
      expect(resolveBranchDiffState(false, true, 2)).toBe(
        BRANCH_DIFF_STATE.EDITING,
      );
    });

    it('変更が無く commit があれば commit 済み', () => {
      expect(resolveBranchDiffState(false, false, 1)).toBe(
        BRANCH_DIFF_STATE.COMMITTED,
      );
    });

    it('変更も commit も無ければ無変更', () => {
      expect(resolveBranchDiffState(false, false, 0)).toBe(
        BRANCH_DIFF_STATE.UNCHANGED,
      );
    });
  });

  describe('起点が状態で切り替わる', () => {
    it('分岐直後は無変更 — 差分を出さない', async () => {
      const { view } = await openBranch();
      expect(view.result.current.diffState).toBe(BRANCH_DIFF_STATE.UNCHANGED);
      expect(view.result.current.pendingChanges).toEqual([]);
      expect(view.result.current.updatedNodeIds.size).toBe(0);
      expect(view.result.current.addedNodeIds.size).toBe(0);
    });

    it('編集すると変更中になり、分岐点からの差分が出る', async () => {
      const { view, base } = await openBranch();
      await edit(view, relabelNode(base, NODE_A, '編集した'));

      expect(view.result.current.diffState).toBe(BRANCH_DIFF_STATE.EDITING);
      expect(view.result.current.updatedNodeIds.has(NODE_A)).toBe(true);
      expect(view.result.current.pendingChanges).toHaveLength(1);
    });

    it('commit すると起点が分岐点へ切り替わる (= 次の merge の対象)', async () => {
      // 仕様: commit 完了後は分岐点との差分が「同じように」出続ける。
      // 消えるのは commit 対象 (pendingChanges) の方である。
      const { view, base } = await openBranch();
      await edit(view, relabelNode(base, NODE_A, '編集した'));
      await commit(view, '1 回目');

      expect(view.result.current.diffState).toBe(BRANCH_DIFF_STATE.COMMITTED);
      expect(view.result.current.pendingChanges).toEqual([]);
      expect(view.result.current.updatedNodeIds.has(NODE_A)).toBe(true);
    });

    it('🔴 commit 後に編集すると、commit 済みの変更はハイライトから外れる', async () => {
      // これが ANA-120 の核心。以前はハイライトが常に分岐点基準だったため、
      // commit 済みの NODE_B が「変更中」の画面に出続け、commit ダイアログ
      // (直近コミット基準) と食い違っていた。
      const { view, base } = await openBranch();
      const withB = addNode(base, NODE_B);
      await edit(view, withB);
      await commit(view, 'B を追加');
      expect(view.result.current.addedNodeIds.has(NODE_B)).toBe(true); // commit 済み表示

      await edit(view, relabelNode(withB, NODE_A, 'A だけ編集'));

      expect(view.result.current.diffState).toBe(BRANCH_DIFF_STATE.EDITING);
      expect(view.result.current.addedNodeIds.has(NODE_B)).toBe(false);
      expect(view.result.current.updatedNodeIds.has(NODE_A)).toBe(true);
    });

    it('ハイライトと commit ダイアログの内容が同じ差分を指す', async () => {
      const { view, base } = await openBranch();
      const withB = addNode(base, NODE_B);
      await edit(view, withB);
      await commit(view, 'B を追加');
      await edit(view, relabelNode(withB, NODE_A, 'A だけ編集'));

      const { pendingChanges, addedNodeIds, updatedNodeIds } =
        view.result.current;
      const fromDialog = new Set(
        pendingChanges.map((c) =>
          'nodeId' in c.op ? (c.op.nodeId as string) : '',
        ),
      );
      expect(fromDialog).toEqual(new Set([...addedNodeIds, ...updatedNodeIds]));
    });

    it('ゴースト表示も同じ起点に従う', async () => {
      // 削除を commit した後は、その削除は「変更中」の差分ではなくなるので
      // ゴーストも消える (分岐点基準のままだと残り続けていた)。
      const { view, base } = await openBranch();
      const withoutA = removeNode(base, NODE_A);
      await edit(view, withoutA);
      expect(view.result.current.deletedNodes.map((n) => n.id)).toEqual([
        NODE_A,
      ]);

      await commit(view, 'A を削除');
      expect(view.result.current.deletedNodes.map((n) => n.id)).toEqual([
        NODE_A,
      ]); // commit 済み = 分岐点基準

      await edit(view, addNode(withoutA, NODE_B));
      expect(view.result.current.diffState).toBe(BRANCH_DIFF_STATE.EDITING);
      expect(view.result.current.deletedNodes).toEqual([]);
    });

    it('trunk に戻ると状態は trunk になり差分は出ない', async () => {
      const { view, base } = await openBranch();
      await edit(view, relabelNode(base, NODE_A, '編集した'));
      await act(async () => {
        await view.result.current.handleSelectBranch(SHEET_ID, null);
      });

      expect(view.result.current.diffState).toBe(BRANCH_DIFF_STATE.TRUNK);
      expect(view.result.current.pendingChanges).toEqual([]);
      expect(view.result.current.updatedNodeIds.size).toBe(0);
      expect(view.result.current.deletedNodes).toEqual([]);
    });
  });

  /**
   * merge 済み branch を**開き直した**ときの起点 (ANA-119 S6)。
   *
   * 同一セッション中は `afterMerge` が merge 時点を控えているので正しかったが、
   * その控えは React の state / ref なのでアプリを閉じると消える。以前は
   * 「merge 済みコミット数」もセッション内の ref に積んでいたため、開き直すと
   * **起点が元の分岐点に戻り、merge 済みの内容まで差分に出ていた**。
   *
   * S4 で merge が `commits` に `sourceAt` 付きで載るようになったので、
   * merge 時点をログから導けるようになった。
   */
  describe('merge 済み branch の再オープン (ANA-119 S6)', () => {
    /** merge まで済ませた branch と、その op-log ストアを返す */
    async function mergedBranch() {
      const { view, base } = await openBranch();
      await edit(view, relabelNode(base, NODE_A, 'branch で編集'));
      await commit(view, '編集をコミット');
      answerMergeReason('branch を取り込む');
      await act(async () => {
        await view.result.current.handleMergeBranch(view.branch);
      });
      expect(view.result.current.diffState).toBe(BRANCH_DIFF_STATE.UNCHANGED);
      return view;
    }

    /** アプリを開き直して同じ branch を選び直す */
    async function reopen(view: View) {
      const reopened = await renderOplog(undefined, {
        realChanges: true,
        reuse: view.oplogDeps,
      });
      const merged = (await view.oplogDeps.fetchBranches(TRUNK_ID)).find(
        (b) => b.id === view.branch.id,
      );
      if (!merged) throw new Error('merge 済み branch が見つからない');
      await act(async () => {
        await reopened.result.current.handleSelectBranch(SHEET_ID, merged);
      });
      // 画面には branch の projection が載る (開き直した直後は未編集)
      await edit(reopened, projectedSheet());
      return reopened;
    }

    it('🔴 起点が merge 時点になり、merge 済みの変更は差分に出ない', async () => {
      const view = await mergedBranch();
      const reopened = await reopen(view);

      expect(reopened.result.current.diffState).toBe(
        BRANCH_DIFF_STATE.UNCHANGED,
      );
      expect(reopened.result.current.updatedNodeIds.size).toBe(0);
      expect(reopened.result.current.newCommitsSinceMerge).toBe(0);
    });

    it('開き直した後の編集は「変更中」として出る', async () => {
      const view = await mergedBranch();
      const reopened = await reopen(view);
      await edit(
        reopened,
        relabelNode(projectedSheet(), NODE_A, 'merge 後の編集'),
      );

      expect(reopened.result.current.diffState).toBe(BRANCH_DIFF_STATE.EDITING);
      expect(reopened.result.current.updatedNodeIds.has(NODE_A)).toBe(true);
      expect(reopened.result.current.pendingChanges).toHaveLength(1);
    });

    it('開き直した後の commit は「次の merge の対象」になる', async () => {
      const view = await mergedBranch();
      const reopened = await reopen(view);
      await edit(
        reopened,
        relabelNode(projectedSheet(), NODE_A, 'merge 後の編集'),
      );
      await commit(reopened, '2 回目');

      // 起点は merge 時点なので、差分は merge 後の編集**だけ**
      expect(reopened.result.current.diffState).toBe(
        BRANCH_DIFF_STATE.COMMITTED,
      );
      expect(reopened.result.current.newCommitsSinceMerge).toBe(1);
      expect(reopened.result.current.updatedNodeIds.has(NODE_A)).toBe(true);
      expect(reopened.result.current.pendingChanges).toEqual([]);
    });
  });
});
