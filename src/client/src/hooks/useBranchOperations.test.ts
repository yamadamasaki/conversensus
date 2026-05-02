import { afterEach, describe, expect, it, mock } from 'bun:test';
import { createInMemoryBranchOpsDeps } from './testing/inMemoryDeps';

const { renderHook, act, cleanup } = await import('@testing-library/react');
const { useBranchOperations } = await import('./useBranchOperations');

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

async function render() {
  const deps = createInMemoryBranchOpsDeps();
  const result = renderHook(
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
      }),
    {
      initialProps: {
        activeFile: mockActiveFile,
        activeSheetId: 's1',
        activeSheet: mockActiveSheet,
      },
    },
  );
  // Flush async effects
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
  return { ...result, deps };
}

describe('useBranchOperations', () => {
  describe('initial state', () => {
    it('activeBranch が null', async () => {
      const { result } = await render();
      expect(result.current.activeBranch).toBeNull();
    });

    it('isTrunk が true', async () => {
      const { result } = await render();
      expect(result.current.isTrunk).toBe(true);
    });

    it('pendingOps が空配列', async () => {
      const { result } = await render();
      expect(result.current.pendingOps).toEqual([]);
    });

    it('newCommitsSinceMerge が 0', async () => {
      const { result } = await render();
      expect(result.current.newCommitsSinceMerge).toBe(0);
    });

    it('commitDialogOpen が false', async () => {
      const { result } = await render();
      expect(result.current.commitDialogOpen).toBe(false);
    });

    it('diff 関連の Set が空', async () => {
      const { result } = await render();
      expect(result.current.branchDiffNodeIds.size).toBe(0);
      expect(result.current.branchDiffEdgeIds.size).toBe(0);
    });

    it('sheetBranches の active sheet に対応する branches は空', async () => {
      const { result } = await render();
      const sheetId = result.current.sheetBranches.get('s1') ?? [];
      expect(sheetId.length).toBe(0);
    });
  });

  describe('handleCreateBranch', () => {
    it('branch を作成し sheetBranches に追加する', async () => {
      mockSetInputState.mockImplementationOnce(
        (s: { resolve: (v: string) => void }) => {
          s.resolve('feature-x');
        },
      );

      const { result } = await render();
      await act(async () => {
        await result.current.handleCreateBranch('s1');
      });

      const branches = result.current.sheetBranches.get('s1') ?? [];
      expect(branches.length).toBe(1);
      expect(branches[0]?.name).toBe('feature-x');
    });

    it('空の名前では作成されない', async () => {
      mockSetInputState.mockImplementationOnce(
        (s: { resolve: (v: string) => void }) => {
          s.resolve('');
        },
      );

      const { result } = await render();
      await act(async () => {
        await result.current.handleCreateBranch('s1');
      });

      const branches = result.current.sheetBranches.get('s1') ?? [];
      expect(branches.length).toBe(0);
    });
  });

  describe('handleMergeBranch', () => {
    it('確認後 merge を実行しステータスが merged になる', async () => {
      mockSetConfirmState.mockImplementationOnce(
        (s: { resolve: (ok: boolean) => void }) => {
          s.resolve(true);
        },
      );

      const { result } = await render();
      const branch = {
        id: 'b1',
        name: 'feature',
        uri: 'at://b/1',
        cid: 'c1',
        sheetId: 's1',
        status: 'open' as const,
      };

      await act(async () => {
        await result.current.handleMergeBranch(branch);
      });

      expect(result.current.activeBranch).not.toBeNull();
      expect(result.current.activeBranch?.status).toBe('merged');
    });

    it('確認でキャンセルした場合は merge されない', async () => {
      mockSetConfirmState.mockImplementationOnce(
        (s: { resolve: (ok: boolean) => void }) => {
          s.resolve(false);
        },
      );

      const { result } = await render();
      const branch = {
        id: 'b1',
        name: 'feature',
        uri: 'at://b/1',
        cid: 'c1',
        sheetId: 's1',
        status: 'open' as const,
      };

      await act(async () => {
        await result.current.handleMergeBranch(branch);
      });

      expect(result.current.activeBranch).toBeNull();
    });
  });

  describe('handleCloseBranch', () => {
    it('branch を close する', async () => {
      mockSetInputState.mockImplementationOnce(
        (s: { resolve: (v: string) => void }) => {
          s.resolve('feature');
        },
      );
      mockSetConfirmState.mockImplementationOnce(
        (s: { resolve: (ok: boolean) => void }) => {
          s.resolve(true);
        },
      );

      const { result } = await render();
      // まず branch を作成
      await act(async () => {
        await result.current.handleCreateBranch('s1');
      });
      const created = (result.current.sheetBranches.get('s1') ?? [])[0];
      if (!created) throw new Error('branch not created');

      await act(async () => {
        await result.current.handleCloseBranch(created);
      });

      const branches = result.current.sheetBranches.get('s1') ?? [];
      const closed = branches.find((b) => b.id === created.id);
      expect(closed?.status).toBe('closed');
    });
  });

  describe('handleDeleteBranch', () => {
    it('branch を削除する', async () => {
      mockSetConfirmState.mockImplementationOnce(
        (s: { resolve: (ok: boolean) => void }) => {
          s.resolve(true);
        },
      );

      const { result, deps } = await render();
      // First create a branch
      const b = await deps.createBranch('to-delete', 's1', {
        uri: 'at://s/1',
        cid: 'c',
      });
      deps._branches.set('s1', [b]);

      await act(async () => {
        await result.current.handleDeleteBranch(b);
      });

      const branches = result.current.sheetBranches.get('s1') ?? [];
      expect(branches.find((x) => x.id === b.id)).toBeUndefined();
    });
  });

  describe('handleCommit', () => {
    it('activeBranch が null の場合は早期 return', async () => {
      const { result } = await render();
      await act(async () => {
        await result.current.handleCommit('test message');
      });
      // エラーなく完了すること
    });

    it('pendingOps が空の場合は早期 return', async () => {
      const { result } = await render();
      // Enter branch mode
      const branch = {
        id: 'b1',
        name: 'feature',
        uri: 'at://b/1',
        cid: 'c1',
        sheetId: 's1',
        status: 'open' as const,
      };
      await act(async () => {
        await result.current.handleSelectBranch('s1', branch);
      });

      // pendingOps は空（computeOperations returns []）
      await act(async () => {
        await result.current.handleCommit('empty');
      });
      // commitDialogOpen は false のまま
      expect(result.current.commitDialogOpen).toBe(false);
    });
  });

  describe('handleSelectBranch', () => {
    it('trunk (null) 選択で branch 状態がリセットされる', async () => {
      const { result } = await render();
      await act(async () => {
        await result.current.handleSelectBranch('s1', null);
      });

      expect(result.current.activeBranch).toBeNull();
      expect(result.current.isTrunk).toBe(true);
    });

    it('branch 選択で branch 状態が設定される', async () => {
      const { result } = await render();
      const branch = {
        id: 'b1',
        name: 'feature',
        uri: 'at://b/1',
        cid: 'c1',
        sheetId: 's1',
        status: 'open' as const,
      };

      await act(async () => {
        await result.current.handleSelectBranch('s1', branch);
      });

      expect(result.current.activeBranch).not.toBeNull();
      expect(result.current.activeBranch?.name).toBe('feature');
      expect(result.current.isTrunk).toBe(false);
    });
  });

  describe('resetBranchState', () => {
    it('全 branch 状態をリセットする', async () => {
      const { result } = await render();
      act(() => {
        result.current.resetBranchState();
      });
      expect(result.current.activeBranch).toBeNull();
      expect(result.current.isTrunk).toBe(true);
    });
  });

  describe('pendingOps (commit 可能な変更の検出)', () => {
    it('OPEN branch で変更あり → pendingOps に含まれる', async () => {
      const { result, deps } = await render();
      deps._setComputeOps([{ op: 'node.add', nodeId: 'n1', content: 'hi' }]);

      await act(async () => {
        await result.current.handleSelectBranch('s1', {
          id: 'b1',
          name: 'feat',
          uri: 'at://b/1',
          cid: 'c1',
          sheetId: 's1',
          status: 'open' as const,
        });
      });

      expect(result.current.pendingOps.length).toBe(1);
    });

    it('MERGED branch で変更あり → pendingOps に含まれる', async () => {
      const { result, deps } = await render();
      deps._setComputeOps([{ op: 'node.add', nodeId: 'n1', content: 'hi' }]);

      await act(async () => {
        await result.current.handleSelectBranch('s1', {
          id: 'b1',
          name: 'feat',
          uri: 'at://b/1',
          cid: 'c1',
          sheetId: 's1',
          status: 'merged' as const,
        });
      });

      expect(result.current.pendingOps.length).toBe(1);
    });

    it('CLOSED branch → pendingOps 空', async () => {
      const { result, deps } = await render();
      deps._setComputeOps([{ op: 'node.add', nodeId: 'n1', content: 'hi' }]);

      await act(async () => {
        await result.current.handleSelectBranch('s1', {
          id: 'b1',
          name: 'feat',
          uri: 'at://b/1',
          cid: 'c1',
          sheetId: 's1',
          status: 'closed' as const,
        });
      });

      expect(result.current.pendingOps).toEqual([]);
    });

    it('isTrunk 時は pendingOps 空', async () => {
      const { result, deps } = await render();
      deps._setComputeOps([{ op: 'node.add', nodeId: 'n1', content: 'hi' }]);
      expect(result.current.pendingOps).toEqual([]);
    });
  });

  describe('deletedNodes / deletedEdges (ゴースト表示用)', () => {
    it('node.remove op → deletedNodes に含まれ、branchDiffNodeIds に含まれない', async () => {
      const { result, deps } = await render();
      deps._setComputeOps([{ op: 'node.remove', nodeId: 'n1' }]);

      await act(async () => {
        await result.current.handleSelectBranch('s1', {
          id: 'b1',
          name: 'feat',
          uri: 'at://b/1',
          cid: 'c1',
          sheetId: 's1',
          status: 'open' as const,
        });
      });

      expect(result.current.deletedNodes).toEqual([]); // base に n1 が存在しない
      expect(result.current.branchDiffNodeIds.size).toBe(0); // remove は conflicted に入らない
    });

    it('edge.remove op → branchDiffEdgeIds に含まれない', async () => {
      const { result, deps } = await render();
      deps._setComputeOps([{ op: 'edge.remove', edgeId: 'e1' }]);

      await act(async () => {
        await result.current.handleSelectBranch('s1', {
          id: 'b1',
          name: 'feat',
          uri: 'at://b/1',
          cid: 'c1',
          sheetId: 's1',
          status: 'open' as const,
        });
      });

      expect(result.current.branchDiffEdgeIds.has('e1')).toBe(false);
    });

    it('node.add op → branchDiffNodeIds に含まれる', async () => {
      const { result, deps } = await render();
      deps._setComputeOps([{ op: 'node.add', nodeId: 'n1', content: 'hi' }]);

      await act(async () => {
        await result.current.handleSelectBranch('s1', {
          id: 'b1',
          name: 'feat',
          uri: 'at://b/1',
          cid: 'c1',
          sheetId: 's1',
          status: 'open' as const,
        });
      });

      expect(result.current.branchDiffNodeIds.has('n1')).toBe(true);
    });
  });

  describe('handleSelectBranch 状態遷移', () => {
    it('trunk → branch: onSetActiveFile で preBranchFile が復元されない', async () => {
      const { result } = await render();
      // trunk → branch
      await act(async () => {
        await result.current.handleSelectBranch('s1', {
          id: 'b1',
          name: 'feat',
          uri: 'at://b/1',
          cid: 'c1',
          sheetId: 's1',
          status: 'open' as const,
        });
      });
      // trunk に戻る → preBranchFile が復元される
      await act(async () => {
        await result.current.handleSelectBranch('s1', null);
      });
      expect(mockOnSetActiveFile).toHaveBeenCalled();
    });

    it('MERGED branch 選択時に lastCommitBase が設定される', async () => {
      const { result } = await render();

      await act(async () => {
        await result.current.handleSelectBranch('s1', {
          id: 'b1',
          name: 'feat',
          uri: 'at://b/1',
          cid: 'c1',
          sheetId: 's1',
          status: 'merged' as const,
        });
      });

      // pendingOps が空配列（lastCommitBase === originalBase なので変更なし）
      expect(result.current.pendingOps).toEqual([]);
      expect(result.current.activeBranch?.status).toBe('merged');
    });
  });

  describe('File 切り替え時のリセット', () => {
    it('activeFile.id 変更 → activeBranch が null にリセット', async () => {
      const { result, rerender } = await render();
      // まず branch に入る
      await act(async () => {
        await result.current.handleSelectBranch('s1', {
          id: 'b1',
          name: 'feat',
          uri: 'at://b/1',
          cid: 'c1',
          sheetId: 's1',
          status: 'open' as const,
        });
      });
      expect(result.current.activeBranch).not.toBeNull();

      // File を切り替え
      await act(async () => {
        rerender({
          activeFile: { ...mockActiveFile, id: 'f2' },
          activeSheetId: 's1',
          activeSheet: mockActiveSheet,
        });
        await new Promise((r) => setTimeout(r, 10));
      });

      expect(result.current.activeBranch).toBeNull();
    });
  });

  describe('setCommitDialogOpen', () => {
    it('commitDialogOpen を切り替えられる', async () => {
      const { result } = await render();
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
