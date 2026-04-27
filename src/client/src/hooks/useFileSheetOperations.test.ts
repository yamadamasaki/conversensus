import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { SheetId } from '@conversensus/shared';

// Mock zod (used by api.ts)
mock.module('zod', () => ({
  z: {
    object: () => ({ parse: (x: unknown) => x }),
    string: () => ({}),
    array: () => ({}),
    union: () => ({}),
    literal: () => ({}),
    uuid: () => ({}),
    brand: () => ({}),
    optional: () => ({}),
    nullable: () => ({}),
  },
  default: {
    object: () => ({ parse: (x: unknown) => x }),
  },
}));

const SID1 = '00000000-0000-0000-0000-000000000001' as SheetId;
const SID2 = '00000000-0000-0000-0000-000000000002' as SheetId;

const { renderHook, act, cleanup } = await import('@testing-library/react');
const { useFileSheetOperations } = await import('./useFileSheetOperations');

const mockSetConfirmState = mock(() => {});
const mockSetAlertState = mock(() => {});

afterEach(() => {
  cleanup();
  mockSetConfirmState.mockClear();
  mockSetAlertState.mockClear();
});

function render() {
  return renderHook(() =>
    useFileSheetOperations({
      setConfirmState: mockSetConfirmState,
      setAlertState: mockSetAlertState,
    }),
  );
}

describe('useFileSheetOperations', () => {
  describe('initial state', () => {
    it('files が空配列', () => {
      const { result } = render();
      expect(result.current.files).toEqual([]);
    });

    it('activeFile が null', () => {
      const { result } = render();
      expect(result.current.activeFile).toBeNull();
    });

    it('activeSheetId が null', () => {
      const { result } = render();
      expect(result.current.activeSheetId).toBeNull();
    });

    it('activeSheet が null', () => {
      const { result } = render();
      expect(result.current.activeSheet).toBeNull();
    });

    it('expandedFileIds が空', () => {
      const { result } = render();
      expect(result.current.expandedFileIds.size).toBe(0);
    });

    it('newFileName が空文字列', () => {
      const { result } = render();
      expect(result.current.newFileName).toBe('');
    });

    it('popupTarget が null', () => {
      const { result } = render();
      expect(result.current.popupTarget).toBeNull();
    });
  });

  describe('exposed setters', () => {
    it('setActiveFile で activeFile を更新できる', () => {
      const { result } = render();
      const file = {
        id: 'f1',
        name: 'test',
        description: '',
        sheets: [{ id: SID1, name: 'Sheet 1', nodes: [], edges: [] }],
      };
      act(() => {
        result.current.setActiveFile(file);
      });
      expect(result.current.activeFile?.id).toBe('f1');
    });

    it('setActiveSheetId で activeSheetId を更新できる', () => {
      const { result } = render();
      act(() => {
        result.current.setActiveSheetId(SID1);
      });
      expect(result.current.activeSheetId).toBe(SID1);
    });

    it('setNewFileName で newFileName を更新できる', () => {
      const { result } = render();
      act(() => {
        result.current.setNewFileName('新しいファイル');
      });
      expect(result.current.newFileName).toBe('新しいファイル');
    });
  });

  describe('activeSheet (derived)', () => {
    it('activeFile が null なら null', () => {
      const { result } = render();
      act(() => {
        result.current.setActiveSheetId(SID1);
      });
      expect(result.current.activeSheet).toBeNull();
    });

    it('activeFile と activeSheetId が一致すれば該当シートを返す', () => {
      const { result } = render();
      act(() => {
        result.current.setActiveFile({
          id: 'f1',
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

  describe('expandedFileIds', () => {
    it('初期状態は空', () => {
      const { result } = render();
      expect(result.current.expandedFileIds.size).toBe(0);
    });
  });
});
