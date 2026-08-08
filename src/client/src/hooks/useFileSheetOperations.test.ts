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

/** hook が要求する操作主体 `<did>#<deviceId>` (Phase 4d-2) */
const TEST_ACTOR =
  'did:plc:test#dev-test' as import('@conversensus/shared').Actor;

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
  remoteQueue?: import('../atproto/remoteSyncQueue').RemoteSyncQueue;
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
      // rkey 移行 marker (p7-4) がこの actor の DID 部分をキーにする
      actor: TEST_ACTOR,
      ...(opts.remoteQueue !== undefined && { remoteQueue: opts.remoteQueue }),
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

  // Phase 6 p6-3 (設計 §3.6): 読取は op-log 単独になった。W3d の dual-read
  // フォールバックと安全弁 `READ_FROM_OPLOG` はここで役目を終える。
  // 旧テストは削除せず **意味を反転**させて残す (「snapshot へ退避する」→「退避しない」)。
  describe('openFile — op-log 単独読取 (Phase 6 p6-3)', () => {
    /** 1 件作って activeFile を外し、開き直せる状態にする */
    async function createThenClose(
      result: { current: ReturnType<typeof useFileSheetOperations> },
      act_: typeof act,
    ) {
      await act_(async () => {
        await result.current.handleCreate();
      });
      const fileId = result.current.activeFile?.id;
      if (!fileId) throw new Error('activeFile should be set');
      act_(() => {
        result.current.setActiveFile(null);
      });
      return fileId;
    }

    it('op-log (fetchBatches→projectFile) から開ける', async () => {
      const deps = createInMemoryFileSheetOpsDeps();
      deps.fetchBatches = mock(deps.fetchBatches);
      const { result } = await renderWith({ deps });
      const fileId = await createThenClose(result, act);
      (deps.fetchBatches as ReturnType<typeof mock>).mockClear();

      await act(async () => {
        await result.current.openFile(fileId);
      });

      expect(deps.fetchBatches).toHaveBeenCalled();
      expect(result.current.activeFile?.id).toBe(fileId);
      expect(result.current.activeSheetId).toBeTruthy();
    });

    it('🔴 op-log 読取が失敗したら開けない (snapshot へ退避しない)', async () => {
      const deps = createInMemoryFileSheetOpsDeps();
      const { result } = await renderWith({ deps });
      const fileId = await createThenClose(result, act);
      // 以後 op-log 読取は常に失敗する
      deps.fetchBatches = mock(async () => {
        throw new Error('boom');
      });
      mockSetAlertState.mockImplementationOnce((s: { resolve: () => void }) => {
        s.resolve();
      });

      await act(async () => {
        await result.current.openFile(fileId);
      });

      // かつては snapshot (fetchFile) が肩代わりして開けていた。今は開けず alert に至る。
      expect(result.current.activeFile).toBeNull();
      expect(mockSetAlertState).toHaveBeenCalled();
    });

    it('🔴 projection が 0 シートなら開けない (欠損の検出)', async () => {
      const deps = createInMemoryFileSheetOpsDeps();
      const { result } = await renderWith({ deps });
      const fileId = await createThenClose(result, act);
      deps.fetchBatches = mock(async () => []);
      mockSetAlertState.mockImplementationOnce((s: { resolve: () => void }) => {
        s.resolve();
      });

      await act(async () => {
        await result.current.openFile(fileId);
      });

      expect(result.current.activeFile).toBeNull();
      expect(mockSetAlertState).toHaveBeenCalled();
    });
  });

  // 旧 `persistFile` から snapshot 書込を落とした残り (Phase 6 p6-3, 設計 §3.6)。
  // **永続化はしない** — 状態の書込口は op-log tap (syncRecord) だけになった。
  describe('updateFileState', () => {
    it('activeFile と files 一覧を更新する', async () => {
      const { result } = await render();
      await act(async () => {
        await result.current.handleCreate();
      });
      const file = result.current.activeFile;
      if (!file) throw new Error('activeFile should be set');

      act(() => {
        result.current.updateFileState({ ...file, name: 'renamed' });
      });

      expect(result.current.activeFile?.name).toBe('renamed');
      expect(result.current.files[0]?.name).toBe('renamed');
    });

    it('永続化を伴わない (op-log へ emit しない)', async () => {
      // 名前の変更を op-log へ流すのは呼び出し側 (handleSaveFileSettings) の責務。
      // ここが勝手に emit すると二重記録になる。
      const { result, syncRecord } = await render();
      await act(async () => {
        await result.current.handleCreate();
      });
      const file = result.current.activeFile;
      if (!file) throw new Error('activeFile should be set');
      syncRecord.mockClear();

      act(() => {
        result.current.updateFileState({ ...file, name: 'renamed' });
      });

      expect(emittedTypes(syncRecord)).toEqual([]);
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

    // ANA-127 の核心。削除は tombstone なので **op-log は残る** = discovery から見て
    // 「既知」のままでなければならない。ここが崩れると削除したファイルが未知と判定され、
    // PDS から materialize されて次回起動で復活する。
    it('削除しても discovery の既知集合には残る (復活させないため)', async () => {
      mockSetConfirmState.mockImplementationOnce(
        (s: { resolve: (ok: boolean) => void }) => {
          s.resolve(true);
        },
      );

      const deps = createInMemoryFileSheetOpsDeps();
      const { result } = await renderWith({ deps });
      await act(async () => {
        await result.current.handleCreate();
      });
      const created = result.current.activeFile;
      if (!created) throw new Error('activeFile should be set');

      await act(async () => {
        await result.current.handleDeleteFile(created.id);
      });

      // 一覧からは消える
      expect(await deps.fetchFiles()).toEqual([]);
      // が、既知集合には残る
      expect(await deps.fetchLocalFileIds()).toContain(created.id);
    });

    it('削除に失敗したら UI からも消さない', async () => {
      mockSetConfirmState.mockImplementationOnce(
        (s: { resolve: (ok: boolean) => void }) => {
          s.resolve(true);
        },
      );

      const deps = createInMemoryFileSheetOpsDeps();
      deps.deleteFile = async () => {
        throw new Error('daemon down');
      };

      const { result } = await renderWith({ deps });
      await act(async () => {
        await result.current.handleCreate();
      });

      await act(async () => {
        await result.current.handleDeleteFile(
          result.current.activeFile?.id ?? '',
        );
      });

      // 消えたように見えて次の起動で戻る、という状態を作らない
      expect(result.current.files.length).toBe(1);
      expect(result.current.activeFile).not.toBeNull();
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
    // Phase 6 p6-3 (設計 §3.4): 未オープンのファイルの書き出し元が snapshot
    // (`GET /files/:id`) から op-log の projection へ移った。server 側に projection の
    // 第 2 実装を作らないための判断なので、読取経路が 1 本に揃ったことを固定する。
    it('🔴 開いていないファイルは op-log の projection を書き出す', async () => {
      const deps = createInMemoryFileSheetOpsDeps();
      const exported: string[] = [];
      deps.exportFile = (file) => {
        exported.push(file.name);
      };
      const { result } = await renderWith({ deps });
      await act(async () => {
        await result.current.handleCreate();
      });
      const fileId = result.current.activeFile?.id;
      if (!fileId) throw new Error('activeFile should be set');
      act(() => {
        result.current.setActiveFile(null);
      });
      deps.fetchBatches = mock(deps.fetchBatches);

      await act(async () => {
        await result.current.handleExportFile(fileId);
      });

      expect(deps.fetchBatches).toHaveBeenCalled();
      expect(exported).toHaveLength(1);
    });

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

  describe('remote 未知ファイルの発見 (Phase 4e-2b)', () => {
    const NEW_FILE = '99999999-9999-4999-8999-999999999999' as FileId;

    /** remote に未知ファイルの batch がある状態の RemoteSyncQueue を作る */
    async function makeRemoteQueue() {
      const { RemoteSyncQueue } = await import('../atproto/remoteSyncQueue');
      const entries = [
        {
          fileId: NEW_FILE,
          batch: {
            id: 'rb1',
            actor: 'did:plc:alice#dev-a',
            clock: 1,
            timestamp: 1,
            ops: [{ kind: 'file.setName', name: '受信ファイル' }],
          },
        },
      ];
      const provider = {
        pushRemote: async () => {},
        pullAllRemoteForMigration: async () => entries,
        // 発見は「列挙 → 未知ファイルだけ取得」(Phase 7 p7-3)
        listRemoteFiles: async () =>
          [...new Set(entries.map((e) => e.fileId))].map((fileId) => ({
            fileId,
            deleted: false,
          })),
        pullRemoteForFile: async (fileId: string) =>
          entries.filter((e) => e.fileId === fileId),
      };
      // biome-ignore lint/suspicious/noExplicitAny: テスト用の最小 provider
      return new RemoteSyncQueue({ provider: provider as any });
    }

    it('mount 時に未知ファイルを materialize し一覧を再読込する', async () => {
      const deps = createInMemoryFileSheetOpsDeps();
      const received: string[] = [];
      deps.pushReceivedBatches = async (fileId, batches) => {
        received.push(fileId);
        // materialize されると GET /files (op-log 和集合, 4e-2a) に現れることを模す
        deps._fileList.push({ id: NEW_FILE, name: '受信ファイル' });
        return batches.length;
      };
      const remoteQueue = await makeRemoteQueue();

      const { result } = await renderWith({ deps, remoteQueue });

      expect(received).toEqual([NEW_FILE]);
      // 発見後の再読込で Sidebar 一覧に現れる
      expect(result.current.files.map((f) => f.id)).toContain(NEW_FILE);
    });

    it('既知ファイルしか無ければ書き込みも再読込も起きない', async () => {
      const deps = createInMemoryFileSheetOpsDeps();
      // ローカルに既知として登録しておく
      deps._fileList.push({ id: NEW_FILE, name: '既知' });
      const received: string[] = [];
      deps.pushReceivedBatches = async (fileId, batches) => {
        received.push(fileId);
        return batches.length;
      };
      const remoteQueue = await makeRemoteQueue();

      await renderWith({ deps, remoteQueue });

      expect(received).toEqual([]);
    });

    it('remoteQueue が無ければ発見は起きない (未ログイン時)', async () => {
      const deps = createInMemoryFileSheetOpsDeps();
      const received: string[] = [];
      deps.pushReceivedBatches = async (fileId, batches) => {
        received.push(fileId);
        return batches.length;
      };

      await renderWith({ deps });

      expect(received).toEqual([]);
    });
  });

  describe('rkey 移行の配線 (Phase 7 p7-4)', () => {
    const OLD_FILE = '77777777-7777-4777-8777-777777777777' as FileId;

    /**
     * 旧 rkey のレコードしか無い remote を模した queue。
     *
     * **列挙 (`listRemoteFiles`) は空を返す** — 旧 rkey は `v1~` より小さく新経路の
     * 走査に現れないので、これが移行前の実際の見え方である。つまり発見だけでは
     * このファイルに到達できず、**移行の全件受信 (`pullAllRemoteForMigration`) だけが拾える**。
     */
    async function makeLegacyRemoteQueue() {
      const { RemoteSyncQueue } = await import('../atproto/remoteSyncQueue');
      const entries = [
        {
          fileId: OLD_FILE,
          batch: {
            id: 'old-1',
            actor: 'did:plc:alice#dev-a',
            clock: 1,
            timestamp: 1,
            ops: [{ kind: 'file.setName', name: '旧形式ファイル' }],
          },
        },
      ];
      const calls = { pullAllRemoteForMigration: 0, createRemote: 0 };
      const provider = {
        pushRemote: async () => {},
        // 移行の再 push は applyWrites のまとめ書きを通る (Phase 7 p7-4)
        createRemote: async () => {
          calls.createRemote += 1;
        },
        pullAllRemoteForMigration: async () => {
          calls.pullAllRemoteForMigration += 1;
          return entries;
        },
        listRemoteFiles: async () => [], // 新経路からは見えない
        pullRemoteForFile: async () => [], // 新形式ではまだ 1 件も載っていない
      };
      const queue = new RemoteSyncQueue({
        // biome-ignore lint/suspicious/noExplicitAny: テスト用の最小 provider
        provider: provider as any,
      });
      return { queue, calls };
    }

    it('marker が無ければ移行が走り、新経路から見えないファイルを取り込む', async () => {
      const deps = createInMemoryFileSheetOpsDeps();
      const received: string[] = [];
      let marked = 0;
      deps.hasRkeyMigrated = () => false;
      deps.markRkeyMigrated = () => {
        marked += 1;
      };
      deps.pushReceivedBatches = async (fileId, batches) => {
        received.push(fileId);
        // materialize を模す。**ローカル正典 (_files) にも入れる** — 移行の再 push は
        // 「受信で正典に入った内容」を読み直して新 rkey で載せ直すので、ここが空だと
        // 手続きの後半 (2) が素通りしてしまう
        deps._files.set(fileId, {
          id: fileId,
          name: '旧形式ファイル',
          description: '',
          sheets: [{ id: SID1, name: 'Sheet 1', nodes: [], edges: [] }],
        });
        deps._fileList.push({ id: OLD_FILE, name: '旧形式ファイル' });
        return batches.length;
      };
      const { queue, calls } = await makeLegacyRemoteQueue();

      const { result } = await renderWith({ deps, remoteQueue: queue });

      expect(calls.pullAllRemoteForMigration).toBe(1); // 全件受信は 1 回だけ
      expect(received).toEqual([OLD_FILE]);
      expect(calls.createRemote).toBe(1); // 新 rkey でまとめて載せ直す
      expect(marked).toBe(1); // 成功したので marker が立つ
      // 移行で materialize されたファイルが Sidebar 一覧に現れる
      expect(result.current.files.map((f) => f.id)).toContain(OLD_FILE);
    });

    it('marker があれば全件 list を実行しない', async () => {
      const deps = createInMemoryFileSheetOpsDeps();
      deps.hasRkeyMigrated = () => true;
      const { queue, calls } = await makeLegacyRemoteQueue();

      await renderWith({ deps, remoteQueue: queue });

      expect(calls.pullAllRemoteForMigration).toBe(0);
      expect(calls.createRemote).toBe(0);
    });

    it('移行が失敗しても発見は走る (発見は非破壊で独立に価値がある)', async () => {
      const { RemoteSyncQueue } = await import('../atproto/remoteSyncQueue');
      const DISCOVERED = '66666666-6666-4666-8666-666666666666' as FileId;
      const entries = [
        {
          fileId: DISCOVERED,
          batch: {
            id: 'new-1',
            actor: 'did:plc:alice#dev-a',
            clock: 1,
            timestamp: 1,
            ops: [{ kind: 'file.setName', name: '新形式ファイル' }],
          },
        },
      ];
      const provider = {
        pushRemote: async () => {},
        pullAllRemoteForMigration: async () => {
          throw new Error('offline');
        },
        listRemoteFiles: async () => [{ fileId: DISCOVERED, deleted: false }],
        pullRemoteForFile: async () => entries,
      };
      const deps = createInMemoryFileSheetOpsDeps();
      const received: string[] = [];
      let marked = 0;
      deps.hasRkeyMigrated = () => false;
      deps.markRkeyMigrated = () => {
        marked += 1;
      };
      deps.pushReceivedBatches = async (fileId, batches) => {
        received.push(fileId);
        return batches.length;
      };

      await renderWith({
        deps,
        // biome-ignore lint/suspicious/noExplicitAny: テスト用の最小 provider
        remoteQueue: new RemoteSyncQueue({ provider: provider as any }),
      });

      expect(received).toEqual([DISCOVERED]); // 発見は走った
      expect(marked).toBe(0); // 移行は未完了のまま (次回起動で再試行)
    });
  });

  describe('受信着地後の画面反映 (Phase 4e-3 / 4e-4)', () => {
    const RECV_NODE = '88888888-8888-4888-8888-888888888888';

    /** 開いているファイル宛の batch を remote に持つ RemoteSyncQueue を作る */
    async function makeRemoteQueueFor(fileId: string) {
      const { RemoteSyncQueue } = await import('../atproto/remoteSyncQueue');
      const entries = [
        {
          fileId,
          batch: {
            id: 'rb-open-1',
            actor: 'did:plc:alice#dev-b',
            clock: 100,
            timestamp: 1,
            ops: [{ kind: 'node.add', nodeId: RECV_NODE, content: 'B の編集' }],
          },
        },
      ];
      const provider = {
        pushRemote: async () => {},
        pullAllRemoteForMigration: async () => entries,
        // 受信はファイル単位取得を通る (Phase 7 p7-2)
        pullRemoteForFile: async (id: string) =>
          entries.filter((e) => e.fileId === id),
      };
      // biome-ignore lint/suspicious/noExplicitAny: テスト用の最小 provider
      return new RemoteSyncQueue({ provider: provider as any });
    }

    it('開いているファイルへの受信で activeFile が差し替わり receiveEpoch が増える', async () => {
      const deps = createInMemoryFileSheetOpsDeps();
      const file = await deps.createFile('受信対象');
      // 受信着地を模す: ストアのファイルへノードを足す。以後の fetchBatches
      // (= 再 projection の読取) にこのノードが現れる = デーモンへの着地と同じ見え方
      deps.pushReceivedBatches = async (fileId, batches) => {
        deps._files.get(fileId)?.sheets[0]?.nodes.push({
          id: RECV_NODE,
          content: 'B の編集',
        } as (typeof file.sheets)[0]['nodes'][number]);
        return batches.length;
      };
      const remoteQueue = await makeRemoteQueueFor(file.id);

      const { result } = await renderWith({ deps, remoteQueue });
      expect(result.current.receiveEpoch).toBe(0);

      await act(async () => {
        await result.current.openFile(file.id);
      });
      // open 契機の受信 → onReceived → 再 projection → swap を待つ
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });

      // 受信 swap: activeFile が受信ノードを含む projection に差し替わる
      expect(
        result.current.activeFile?.sheets[0]?.nodes.some(
          (n) => n.id === RECV_NODE,
        ),
      ).toBe(true);
      // GraphEditor の React Flow 再 seed トリガ (4e-4 実機で発見した欠陥の回帰試験)
      expect(result.current.receiveEpoch).toBe(1);
    });

    it('受信が既知分のみ (appended=0) なら swap も epoch 増加も起きない', async () => {
      const deps = createInMemoryFileSheetOpsDeps();
      const file = await deps.createFile('受信対象');
      // 着地 0 件 = 全 batch が既知 (べき等再受信)
      deps.pushReceivedBatches = async () => 0;
      const remoteQueue = await makeRemoteQueueFor(file.id);

      const { result } = await renderWith({ deps, remoteQueue });
      await act(async () => {
        await result.current.openFile(file.id);
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });

      expect(result.current.receiveEpoch).toBe(0);
    });
  });

  // 【削除済】`persistFile` の branch ガード (Phase 5 p5-4)
  //
  // 「branch 表示中は snapshot を書かない」ガードは Phase 6 p6-3 で **構造ごと消えた** —
  // 書込先 (`saveFile` / `syncFileToAtproto`) が `FileSheetOpsDeps` から無くなったので、
  // 漏れようがない (設計 §3.6)。ガードのテストも一緒に退役させた。
  // Phase 5 critic の「呼び出し側ごとのガードは必ず漏れる」への最終的な答えがこれ。
});
