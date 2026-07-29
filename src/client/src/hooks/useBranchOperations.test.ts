import { afterEach, describe, expect, it, mock } from 'bun:test';
import {
  createInMemoryBranchOplogDeps,
  createInMemoryBranchOpsDeps,
} from './testing/inMemoryDeps';

const { renderHook, act, cleanup } = await import('@testing-library/react');
const { useBranchOperations } = await import('./useBranchOperations');
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

const mockOnSetActiveFile = mock(() => {});
const mockSetConfirmState = mock(() => {});
const mockSetInputState = mock(() => {});
const mockSetAlertState = mock(() => {});

const mockActiveFile = {
  id: 'f1',
  name: 'test',
  description: '',
  sheets: [{ id: 's1', name: 'Sheet 1', nodes: [], edges: [] }],
};
const mockActiveSheet = { id: 's1', name: 'Sheet 1', nodes: [], edges: [] };

afterEach(() => {
  cleanup();
  mockOnSetActiveFile.mockClear();
  mockSetConfirmState.mockClear();
  mockSetInputState.mockClear();
  mockSetAlertState.mockClear();
});
// --- テストの共通ハーネス ---

const TRUNK_ID = 'f1';
const SHEET_ID = 's1';

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

// `graphEventToBatch` は API 境界と同じ zod 検証を通すので、id は実 UUID 形式で作る
let uuidSeq = 0;
const uuid = () => {
  uuidSeq += 1;
  return `${uuidSeq.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
};

/** node.setContent を 1 件生む content イベント */
const relabel = (to: string) => ({
  id: uuid(),
  timestamp: 1,
  category: 'content' as const,
  type: 'NODE_RELABELED' as const,
  // biome-ignore lint/suspicious/noExplicitAny: branded NodeId をテストで作らない
  nodeId: uuid() as any,
  from: '',
  to,
});

async function renderOplog(
  trunkLog = [trunkBatch('t1', 3, 'n1', 'trunk')],
  options: { slowBranchPush?: boolean } = {},
) {
  const deps = createInMemoryBranchOpsDeps();
  const oplogDeps = createInMemoryBranchOplogDeps();
  oplogDeps._batches.set(TRUNK_ID, trunkLog);
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
        deps,
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
 * `pending` は「表示上の未コミット変更」— `pendingOps` は `computeOperations` の
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
  mockSetInputState.mockImplementationOnce(
    (s: { resolve: (v: string) => void }) => {
      s.resolve('feature-x');
    },
  );
  await act(async () => {
    await view.result.current.handleCreateBranch(SHEET_ID);
  });
  const branch = (view.result.current.sheetBranches.get(SHEET_ID) ??
    [])[0] as import('@conversensus/shared').BranchMeta;
  await act(async () => {
    await view.result.current.handleSelectBranch(SHEET_ID, branch);
  });
  return { ...view, branch };
}
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

    it('pendingOps が空配列', async () => {
      const { result } = await renderOplog();
      expect(result.current.pendingOps).toEqual([]);
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
      mockSetInputState.mockImplementationOnce(
        (s: { resolve: (v: string) => void }) => {
          s.resolve('');
        },
      );
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
   * `pendingOps` は「コミットできる変更があるか」= コミットボタンの有効/無効。
   * status ごとの出し分けを固定する — CLOSED の branch にコミットさせないため。
   */
  describe('pendingOps (commit 可能な変更の検出)', () => {
    const ops = [{ op: 'node.add', nodeId: 'n1', content: 'hi' }];

    it('OPEN branch で変更あり → pendingOps に含まれる', async () => {
      const view = await withOpenBranch(undefined, ops);
      expect(view.result.current.pendingOps.length).toBe(1);
    });

    it('MERGED branch で変更あり → pendingOps に含まれる', async () => {
      const view = await withOpenBranch(undefined, ops);
      await selectWithStatus(view, 'merged');
      expect(view.result.current.pendingOps.length).toBe(1);
    });

    it('CLOSED branch → pendingOps 空', async () => {
      const view = await withOpenBranch(undefined, ops);
      await selectWithStatus(view, 'closed');
      expect(view.result.current.pendingOps).toEqual([]);
    });

    it('isTrunk 時は pendingOps 空', async () => {
      const view = await renderOplog();
      view.deps._setComputeOps(ops);
      expect(view.result.current.pendingOps).toEqual([]);
    });
  });

  describe('deletedNodes / deletedEdges (ゴースト表示用)', () => {
    it('node.remove op → deletedNodes に含まれ、addedNodeIds に含まれない', async () => {
      const view = await withOpenBranch(undefined, [
        { op: 'node.remove', nodeId: 'n1' },
      ]);
      // base (branch 作成時点の projection) にある n1 がゴーストとして残る
      expect(view.result.current.deletedNodes.map((n) => n.id)).toEqual(['n1']);
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
          activeFile: { ...mockActiveFile, id: 'f2' },
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
      mockSetInputState.mockImplementationOnce(
        (s: { resolve: (v: string) => void }) => {
          s.resolve('feature-x');
        },
      );
      await act(async () => {
        await result.current.handleCreateBranch(SHEET_ID);
      });

      const branches = result.current.sheetBranches.get(SHEET_ID) ?? [];
      expect(branches).toHaveLength(1);
      const meta = branches[0] as import('@conversensus/shared').BranchMeta;
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
      const passed = mockOnSetActiveFile.mock.calls.at(-1)?.[0] as
        | import('@conversensus/shared').GraphFile
        | undefined;
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
      // pendingOps は diff 由来 (表示用) なので、変更ありの状態で選択させる
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

      mockSetConfirmState.mockImplementationOnce(
        (s: { resolve: (ok: boolean) => void }) => {
          s.resolve(true);
        },
      );
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

    it('確認でキャンセルすると trunk は変わらない', async () => {
      const { result, branch, oplogDeps } = await withOpenBranch();
      mockSetConfirmState.mockImplementationOnce(
        (s: { resolve: (ok: boolean) => void }) => {
          s.resolve(false);
        },
      );
      await act(async () => {
        await result.current.handleMergeBranch(branch);
      });
      expect(oplogDeps._batches.get(TRUNK_ID)).toHaveLength(1);
      expect(oplogDeps._branches.get(branch.id)?.status).toBe('open');
    });
  });

  describe('handleCloseBranch / handleDeleteBranch', () => {
    it('close は status を closed にする (op-log は残る)', async () => {
      const { result, branch, oplogDeps } = await withOpenBranch();
      mockSetConfirmState.mockImplementationOnce(
        (s: { resolve: (ok: boolean) => void }) => {
          s.resolve(true);
        },
      );
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
      mockSetConfirmState.mockImplementationOnce(
        (s: { resolve: (ok: boolean) => void }) => {
          s.resolve(true);
        },
      );
      await act(async () => {
        await result.current.handleDeleteBranch(branch);
      });
      expect(oplogDeps._branches.has(branch.id)).toBe(false);
      expect(oplogDeps._batches.has(branch.branchFileId)).toBe(false);
      expect(result.current.sheetBranches.get(SHEET_ID)).toEqual([]);
    });
  });
});
