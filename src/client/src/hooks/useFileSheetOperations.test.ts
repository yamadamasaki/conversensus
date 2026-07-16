import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { ConversensusFile, FileId, SheetId } from '@conversensus/shared';

// Mock zod before module imports (imported transitively via ../api and atproto packages)
const zodProxy: Record<string, unknown> = new Proxy(() => zodProxy, {
  get: () => zodProxy,
  apply: () => zodProxy,
}) as unknown as Record<string, unknown>;

mock.module('zod', () => ({
  z: zodProxy,
  default: zodProxy,
}));

const { renderHook, act, cleanup } = await import('@testing-library/react');
const { useFileSheetOperations } = await import('./useFileSheetOperations');
const { createInMemoryFileSheetOpsDeps } = await import(
  './testing/inMemoryDeps'
);

const SID1 = '00000000-0000-0000-0000-000000000001' as SheetId;
const SID2 = '00000000-0000-0000-0000-000000000002' as SheetId;

const mockSetConfirmState = mock(() => {});
const mockSetAlertState = mock(() => {});

afterEach(() => {
  cleanup();
  mockSetConfirmState.mockClear();
  mockSetAlertState.mockClear();
});

type RenderOpts = {
  deps?: ReturnType<typeof createInMemoryFileSheetOpsDeps>;
  readFromOplog?: boolean;
};

async function renderWith(opts: RenderOpts = {}) {
  const deps = opts.deps ?? createInMemoryFileSheetOpsDeps();
  // op-log tap を差し替え、実ネットワーク (LocalServerSyncProvider) を避けつつ
  // 構造操作の dual-write emit を検証する
  const syncRecord = mock((_event: { type: string }) => {});
  const result = renderHook(() =>
    useFileSheetOperations({
      setConfirmState: mockSetConfirmState,
      setAlertState: mockSetAlertState,
      deps,
      syncRecord: syncRecord as unknown as (event: never) => void,
      ...(opts.readFromOplog !== undefined && {
        readFromOplog: opts.readFromOplog,
      }),
    }),
  );
  // Flush async effects (fetchFiles + ATProto sync)
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
  return { ...result, deps, syncRecord };
}

async function render() {
  return renderWith();
}

/** syncRecord に渡された event の type 一覧 */
function emittedTypes(syncRecord: { mock: { calls: unknown[][] } }): string[] {
  return syncRecord.mock.calls.map(
    (call) => (call[0] as { type: string }).type,
  );
}

describe('useFileSheetOperations', () => {
  describe('initial state', () => {
    it('files が空配列', async () => {
      const { result } = await render();
      expect(result.current.files).toEqual([]);
    });

    it('activeFile が null', async () => {
      const { result } = await render();
      expect(result.current.activeFile).toBeNull();
    });

    it('activeSheetId が null', async () => {
      const { result } = await render();
      expect(result.current.activeSheetId).toBeNull();
    });

    it('activeSheet が null', async () => {
      const { result } = await render();
      expect(result.current.activeSheet).toBeNull();
    });

    it('expandedFileIds が空', async () => {
      const { result } = await render();
      expect(result.current.expandedFileIds.size).toBe(0);
    });

    it('newFileName が空文字列', async () => {
      const { result } = await render();
      expect(result.current.newFileName).toBe('');
    });

    it('popupTarget が null', async () => {
      const { result } = await render();
      expect(result.current.popupTarget).toBeNull();
    });
  });

  describe('handleCreate', () => {
    it('新規ファイルを作成し activeFile / activeSheetId が設定される', async () => {
      const { result } = await render();
      await act(async () => {
        await result.current.handleCreate();
      });
      expect(result.current.activeFile).not.toBeNull();
      expect(result.current.activeFile?.name).toBe('無題');
      expect(result.current.activeSheetId).toBeTruthy();
      expect(result.current.files.length).toBe(1);
      expect(result.current.newFileName).toBe('');
    });

    it('newFileName が設定されている場合はその名前が使われる', async () => {
      const { result } = await render();
      act(() => {
        result.current.setNewFileName('マイファイル');
      });
      await act(async () => {
        await result.current.handleCreate();
      });
      expect(result.current.activeFile?.name).toBe('マイファイル');
    });
  });

  describe('openFile', () => {
    it('ファイルを開き activeFile / activeSheetId を設定する', async () => {
      const { result } = await render();
      await act(async () => {
        await result.current.handleCreate();
      });
      const fileId = result.current.activeFile?.id;

      act(() => {
        result.current.setActiveFile(null);
      });

      await act(async () => {
        await result.current.openFile(fileId);
      });

      expect(result.current.activeFile?.id).toBe(fileId);
      expect(result.current.activeSheetId).toBeTruthy();
      expect(result.current.expandedFileIds.has(fileId)).toBe(true);
    });

    it('ファイルが見つからない場合はエラー通知を表示する', async () => {
      mockSetAlertState.mockImplementationOnce((s: { resolve: () => void }) => {
        s.resolve();
      });

      const { result } = await render();
      await act(async () => {
        await result.current.openFile('nonexistent');
      });

      expect(mockSetAlertState).toHaveBeenCalledTimes(1);
    });
  });

  describe('openFile — W3d dual-read (READ_FROM_OPLOG)', () => {
    it('flag ON: op-log (fetchBatches→projectFile) から読み、snapshot は読まない', async () => {
      const deps = createInMemoryFileSheetOpsDeps();
      deps.fetchBatches = mock(deps.fetchBatches);
      deps.fetchFile = mock(deps.fetchFile);
      const { result } = await renderWith({ deps, readFromOplog: true });

      await act(async () => {
        await result.current.handleCreate();
      });
      const fileId = result.current.activeFile?.id;
      if (!fileId) throw new Error('activeFile should be set');

      act(() => {
        result.current.setActiveFile(null);
      });
      (deps.fetchBatches as ReturnType<typeof mock>).mockClear();
      (deps.fetchFile as ReturnType<typeof mock>).mockClear();

      await act(async () => {
        await result.current.openFile(fileId);
      });

      // op-log 経路で開けており、snapshot 経路 (fetchFile) は触れていない
      expect(deps.fetchBatches).toHaveBeenCalled();
      expect(deps.fetchFile).not.toHaveBeenCalled();
      expect(result.current.activeFile?.id).toBe(fileId);
      expect(result.current.activeSheetId).toBeTruthy();
    });

    it('flag ON + op-log 読取失敗: snapshot にフォールバックして開ける', async () => {
      const deps = createInMemoryFileSheetOpsDeps();
      // op-log 読取は常に失敗させる → snapshot (fetchFile) へフォールバック
      deps.fetchBatches = mock(async () => {
        throw new Error('boom');
      });
      deps.fetchFile = mock(deps.fetchFile);
      const { result } = await renderWith({ deps, readFromOplog: true });

      await act(async () => {
        await result.current.handleCreate();
      });
      const fileId = result.current.activeFile?.id;
      if (!fileId) throw new Error('activeFile should be set via fallback');

      act(() => {
        result.current.setActiveFile(null);
      });
      (deps.fetchFile as ReturnType<typeof mock>).mockClear();

      await act(async () => {
        await result.current.openFile(fileId);
      });

      expect(deps.fetchFile).toHaveBeenCalled();
      expect(result.current.activeFile?.id).toBe(fileId);
    });

    it('flag ON + op-log が空 (0 シート): snapshot にフォールバックする', async () => {
      const deps = createInMemoryFileSheetOpsDeps();
      deps.fetchFile = mock(deps.fetchFile);
      const { result } = await renderWith({ deps, readFromOplog: true });

      // snapshot は残しつつ op-log を空にする → 0 シート projection でフォールバック
      await act(async () => {
        await result.current.handleCreate();
      });
      const fileId = result.current.activeFile?.id;
      if (!fileId) throw new Error('activeFile should be set');

      act(() => {
        result.current.setActiveFile(null);
      });
      deps.fetchBatches = mock(async () => []);
      (deps.fetchFile as ReturnType<typeof mock>).mockClear();

      await act(async () => {
        await result.current.openFile(fileId);
      });

      // 空 op-log は「読取失敗」扱いで snapshot に退避し、正常に開ける
      expect(deps.fetchFile).toHaveBeenCalled();
      expect(result.current.activeFile?.id).toBe(fileId);
      expect(result.current.activeSheetId).toBeTruthy();
    });

    it('flag OFF: snapshot から読み、op-log (fetchBatches) は読まない', async () => {
      const deps = createInMemoryFileSheetOpsDeps();
      deps.fetchBatches = mock(deps.fetchBatches);
      deps.fetchFile = mock(deps.fetchFile);
      const { result } = await renderWith({ deps, readFromOplog: false });

      await act(async () => {
        await result.current.handleCreate();
      });
      const fileId = result.current.activeFile?.id;
      if (!fileId) throw new Error('activeFile should be set');

      act(() => {
        result.current.setActiveFile(null);
      });
      (deps.fetchBatches as ReturnType<typeof mock>).mockClear();
      (deps.fetchFile as ReturnType<typeof mock>).mockClear();

      await act(async () => {
        await result.current.openFile(fileId);
      });

      // 従来経路: snapshot を読み、op-log には一切触れない (即時退行の担保)
      expect(deps.fetchBatches).not.toHaveBeenCalled();
      expect(deps.fetchFile).toHaveBeenCalled();
      expect(result.current.activeFile?.id).toBe(fileId);
    });
  });

  describe('persistFile', () => {
    it('activeFile と files を更新し保存する', async () => {
      const { result } = await render();
      await act(async () => {
        await result.current.handleCreate();
      });
      const file = result.current.activeFile;
      if (!file) throw new Error('activeFile should be set');

      await act(async () => {
        await result.current.persistFile({ ...file, name: 'renamed' });
      });

      expect(result.current.activeFile?.name).toBe('renamed');
      expect(result.current.files[0]?.name).toBe('renamed');
    });
  });

  describe('handleSaveFileSettings', () => {
    it('ファイル名と説明を更新し、変化した項目を op-log へ emit する', async () => {
      const { result, syncRecord } = await render();
      await act(async () => {
        await result.current.handleCreate();
      });
      const activeFile1 = result.current.activeFile;
      if (!activeFile1)
        throw new Error('activeFile should be set after handleCreate');
      const fileId = activeFile1.id;

      await act(async () => {
        await result.current.handleSaveFileSettings(
          fileId,
          '新しい名前',
          '説明文',
        );
      });

      // snapshot (dual-write の一方) は従来通り更新される
      expect(result.current.activeFile?.name).toBe('新しい名前');
      expect(result.current.activeFile?.description).toBe('説明文');
      // op-log (dual-write のもう一方) へ変化項目のみ emit
      expect(emittedTypes(syncRecord)).toEqual([
        'FILE_RENAMED',
        'FILE_DESCRIBED',
      ]);
    });
  });

  describe('handleDeleteFile', () => {
    it('確認後ファイルを削除し activeFile をクリアする', async () => {
      mockSetConfirmState.mockImplementationOnce(
        (s: { resolve: (ok: boolean) => void }) => {
          s.resolve(true);
        },
      );

      const { result } = await render();
      await act(async () => {
        await result.current.handleCreate();
      });
      const activeFile2 = result.current.activeFile;
      if (!activeFile2)
        throw new Error('activeFile should be set after handleCreate');
      const fileId = activeFile2.id;

      await act(async () => {
        await result.current.handleDeleteFile(fileId);
      });

      expect(result.current.activeFile).toBeNull();
      expect(result.current.activeSheetId).toBeNull();
      expect(result.current.files.length).toBe(0);
    });

    it('確認でキャンセルした場合は削除されない', async () => {
      mockSetConfirmState.mockImplementationOnce(
        (s: { resolve: (ok: boolean) => void }) => {
          s.resolve(false);
        },
      );

      const { result } = await render();
      await act(async () => {
        await result.current.handleCreate();
      });
      const activeFile3 = result.current.activeFile;
      if (!activeFile3)
        throw new Error('activeFile should be set after handleCreate');
      const fileId = activeFile3.id;

      await act(async () => {
        await result.current.handleDeleteFile(fileId);
      });

      expect(result.current.activeFile).not.toBeNull();
      expect(result.current.files.length).toBe(1);
    });
  });

  describe('handleImportFile', () => {
    it('インポートしたファイルを active にする', async () => {
      const { result } = await render();
      await act(async () => {
        await result.current.handleImportFile({
          fileType: 'conversensusFile',
          schemaVersion: 3,
          id: 'imported-f1',
          name: 'imported',
          description: '',
          sheets: [
            { id: 'imported-s1', name: 'Sheet 1', nodes: [], edges: [] },
          ],
        } as unknown as ConversensusFile);
      });

      expect(result.current.activeFile?.id).toBe('imported-f1');
      expect(result.current.files.length).toBe(1);
    });
  });

  describe('handleExportFile', () => {
    it('activeFile をエクスポートする', async () => {
      const { result } = await render();
      await act(async () => {
        await result.current.handleCreate();
      });
      const activeFile4 = result.current.activeFile;
      if (!activeFile4)
        throw new Error('activeFile should be set after handleCreate');
      const fileId = activeFile4.id;

      // エクスポートは例外なく完了すること
      await act(async () => {
        await result.current.handleExportFile(fileId);
      });
    });
  });

  describe('handleDeleteSheet', () => {
    it('最後のシートは削除できず alert が表示される', async () => {
      const { result } = await render();
      await act(async () => {
        await result.current.handleCreate();
      });
      const sheetId = result.current.activeSheetId;
      if (!sheetId) throw new Error('activeSheetId should be set');

      mockSetAlertState.mockClear();
      mockSetAlertState.mockImplementationOnce((s: { resolve: () => void }) => {
        s.resolve();
      });

      await act(async () => {
        await result.current.handleDeleteSheet(sheetId);
      });

      expect(mockSetAlertState).toHaveBeenCalledTimes(1);
      expect(result.current.activeSheetId).toBe(sheetId);
    });

    it('シートを削除し op-log へ sheet.remove を emit する (dual-write)', async () => {
      const { result, syncRecord } = await render();
      // 2 シートのファイルを直接セット (handleAddSheet は App 側)
      act(() => {
        result.current.setActiveFile({
          id: 'f1' as FileId,
          name: 'test',
          description: '',
          sheets: [
            { id: SID1, name: 'Sheet 1', nodes: [], edges: [] },
            { id: SID2, name: 'Sheet 2', nodes: [], edges: [] },
          ],
        });
        result.current.setActiveSheetId(SID1);
      });

      await act(async () => {
        await result.current.handleDeleteSheet(SID2);
      });

      // snapshot からシートが消え、op-log へ SHEET_REMOVED
      expect(result.current.activeFile?.sheets.map((s) => s.id)).toEqual([
        SID1,
      ]);
      expect(emittedTypes(syncRecord)).toEqual(['SHEET_REMOVED']);
    });
  });

  describe('handleSaveSheetSettings', () => {
    it('シート名と説明を更新し、変化した項目を op-log へ emit する', async () => {
      const { result, syncRecord } = await render();
      await act(async () => {
        await result.current.handleCreate();
      });
      const sheetId = result.current.activeSheetId;
      if (!sheetId) throw new Error('activeSheetId should be set');

      await act(async () => {
        await result.current.handleSaveSheetSettings(
          sheetId,
          '新しいシート名',
          'シートの説明',
        );
      });

      const sheet = result.current.activeFile?.sheets[0];
      expect(sheet?.name).toBe('新しいシート名');
      expect(sheet?.description).toBe('シートの説明');
      expect(emittedTypes(syncRecord)).toEqual([
        'SHEET_RENAMED',
        'SHEET_DESCRIBED',
      ]);
    });

    it('変化が無ければ何も emit しない (空 batch 回避)', async () => {
      const { result, syncRecord } = await render();
      await act(async () => {
        await result.current.handleCreate();
      });
      const sheetId = result.current.activeSheetId;
      const currentName = result.current.activeFile?.sheets[0]?.name ?? '';
      if (!sheetId) throw new Error('activeSheetId should be set');

      await act(async () => {
        // 同じ名前・説明無しで保存 (無変化)
        await result.current.handleSaveSheetSettings(sheetId, currentName, '');
      });

      expect(emittedTypes(syncRecord)).toEqual([]);
    });
  });

  describe('exposed setters', () => {
    it('setActiveFile で activeFile を更新できる', async () => {
      const { result } = await render();
      const file = {
        id: 'f1' as FileId,
        name: 'test',
        description: '',
        sheets: [{ id: SID1, name: 'Sheet 1', nodes: [], edges: [] }],
      };
      act(() => {
        result.current.setActiveFile(file);
      });
      expect(result.current.activeFile?.id).toBe('f1');
    });

    it('setActiveSheetId で activeSheetId を更新できる', async () => {
      const { result } = await render();
      act(() => {
        result.current.setActiveSheetId(SID1);
      });
      expect(result.current.activeSheetId).toBe(SID1);
    });
  });

  describe('activeSheet (derived)', () => {
    it('activeFile が null なら null', async () => {
      const { result } = await render();
      act(() => {
        result.current.setActiveSheetId(SID1);
      });
      expect(result.current.activeSheet).toBeNull();
    });

    it('activeFile と activeSheetId が一致すれば該当シートを返す', async () => {
      const { result } = await render();
      act(() => {
        result.current.setActiveFile({
          id: 'f1' as FileId,
          name: 'test',
          description: '',
          sheets: [
            { id: SID1, name: 'Sheet 1', nodes: [], edges: [] },
            { id: SID2, name: 'Sheet 2', nodes: [], edges: [] },
          ],
        });
        result.current.setActiveSheetId(SID2);
      });
      expect(result.current.activeSheet?.name).toBe('Sheet 2');
    });
  });
});
