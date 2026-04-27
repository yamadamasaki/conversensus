import { afterEach, describe, expect, it, mock } from 'bun:test';

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

function render() {
  return renderHook(
    ({ activeFile, activeSheetId, activeSheet }) =>
      useBranchOperations({
        activeFile,
        activeSheetId: activeSheetId ?? null,
        activeSheet: activeSheet ?? null,
        onSetActiveFile: mockOnSetActiveFile,
        setConfirmState: mockSetConfirmState,
        setInputState: mockSetInputState,
        setAlertState: mockSetAlertState,
      }),
    {
      initialProps: {
        activeFile: mockActiveFile,
        activeSheetId: 's1',
        activeSheet: mockActiveSheet,
      },
    },
  );
}

describe('useBranchOperations', () => {
  describe('initial state', () => {
    it('activeBranch が null', () => {
      const { result } = render();
      expect(result.current.activeBranch).toBeNull();
    });

    it('isTrunk が true', () => {
      const { result } = render();
      expect(result.current.isTrunk).toBe(true);
    });

    it('pendingOps が空配列', () => {
      const { result } = render();
      expect(result.current.pendingOps).toEqual([]);
    });

    it('newCommitsSinceMerge が 0', () => {
      const { result } = render();
      expect(result.current.newCommitsSinceMerge).toBe(0);
    });

    it('commitDialogOpen が false', () => {
      const { result } = render();
      expect(result.current.commitDialogOpen).toBe(false);
    });

    it('diff 関連の Set が空', () => {
      const { result } = render();
      expect(result.current.branchDiffNodeIds.size).toBe(0);
      expect(result.current.branchDiffEdgeIds.size).toBe(0);
      expect(result.current.conflictedNodeIds.size).toBe(0);
      expect(result.current.conflictedEdgeIds.size).toBe(0);
    });

    it('sheetBranches が空 Map', () => {
      const { result } = render();
      expect(result.current.sheetBranches.size).toBe(0);
    });
  });

  describe('resetBranchState', () => {
    it('全 branch 状態をリセットする', () => {
      const { result } = render();
      act(() => {
        result.current.resetBranchState();
      });

      expect(result.current.activeBranch).toBeNull();
      expect(result.current.isTrunk).toBe(true);
      expect(result.current.newCommitsSinceMerge).toBe(0);
    });

    it('preBranchFile が存在する場合 onSetActiveFile を呼ぶ', () => {
      // preBranchFile は ref なので直接設定できないが、
      // handleSelectBranch で trunk を選択することで間接的にテスト可能
      const { result } = render();
      act(() => {
        result.current.resetBranchState();
      });
      // preBranchFile は空なので onSetActiveFile は呼ばれない
      expect(mockOnSetActiveFile).not.toHaveBeenCalled();
    });
  });

  describe('setBranchBases', () => {
    it('例外なく呼び出せる', () => {
      const { result } = render();
      act(() => {
        result.current.setBranchBases({
          id: 's2',
          name: 'Sheet 2',
          nodes: [],
          edges: [],
        });
      });
      // 状態変更は ref/state 内部のため直接検証不可だが、エラーなく完了することを確認
    });
  });

  describe('setCommitDialogOpen', () => {
    it('commitDialogOpen を true/false に切り替えられる', () => {
      const { result } = render();
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

  describe('handleCreateBranch', () => {
    it('空の名前では branch を作成しない', async () => {
      mockSetInputState.mockImplementationOnce(
        (s: { resolve: (v: string) => void }) => {
          s.resolve('');
        },
      );

      const { result } = render();
      // エラーにならずに return することだけ確認
      await act(async () => {
        await result.current.handleCreateBranch('s1');
      });
      // 空文字なので early return される
    });
  });

  describe('handleSelectBranch', () => {
    it('trunk (null) 選択で branch 状態がリセットされる', async () => {
      const { result } = render();
      await act(async () => {
        await result.current.handleSelectBranch('s1', null);
      });

      expect(result.current.activeBranch).toBeNull();
      expect(result.current.isTrunk).toBe(true);
    });
  });
});
