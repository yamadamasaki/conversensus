import { afterEach, describe, expect, mock, test } from 'bun:test';
import type {
  FileId,
  GraphFileListItem,
  NodeId,
  SheetId,
} from '@conversensus/shared';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { FolderTree } from '../folders/folderTree';
import { GLOBAL_SEARCH_LABEL, GlobalSearchDialog } from './GlobalSearchDialog';
import type { FileSearchHit, FileSearchResult } from './searchFiles';

afterEach(cleanup);

const FILES: GraphFileListItem[] = [
  {
    id: 'file-1' as FileId,
    name: '議事録',
    sheets: [{ id: 'sheet-1' as SheetId, name: 'Sheet 1' }],
  },
];
const TREE: FolderTree = {
  folders: [],
  files: ['file-1' as FileId],
  renames: [],
};

const CONTENT_HIT: FileSearchHit = {
  elementKind: 'node',
  id: 'node-1' as NodeId,
  field: 'content',
  snippet: '合意した',
  matchStart: 0,
  matchLength: 2,
  fileId: 'file-1' as FileId,
  fileName: '議事録',
  sheetId: 'sheet-1' as SheetId,
  sheetName: 'Sheet 1',
};

function renderDialog(
  searchContent: (q: string) => Promise<FileSearchResult>,
  handlers: Partial<{
    onOpenName: () => void;
    onOpenContent: (hit: FileSearchHit) => void;
  }> = {},
) {
  render(
    <GlobalSearchDialog
      files={FILES}
      folderTree={TREE}
      searchContent={searchContent}
      onOpenName={handlers.onOpenName ?? (() => {})}
      onOpenContent={handlers.onOpenContent ?? (() => {})}
      onClose={() => {}}
    />,
  );
  return screen.getByRole('searchbox', { name: '検索語' });
}

const type = (box: HTMLElement, value: string) =>
  fireEvent.change(box, { target: { value } });

describe('GlobalSearchDialog (#248)', () => {
  test('開くと検索語の欄に focus がある', () => {
    const box = renderDialog(async () => ({ hits: [], truncated: false }));
    expect(
      screen.getByRole('dialog', { name: GLOBAL_SEARCH_LABEL }),
    ).toBeTruthy();
    expect(document.activeElement).toBe(box);
  });

  test('名前の当たりはすぐ出し、押すとその行を開く', () => {
    const onOpenName = mock(() => {});
    const box = renderDialog(async () => ({ hits: [], truncated: false }), {
      onOpenName,
    });
    type(box, '議事');
    const names = screen.getByRole('region', { name: '名前の当たり' });
    fireEvent.click(names.querySelector('button') as HTMLButtonElement);
    expect(onOpenName).toHaveBeenCalledTimes(1);
  });

  test('中身は打ち終わってから引き、押すとその 1 件を開く', async () => {
    const calls: string[] = [];
    const onOpenContent = mock((_hit: FileSearchHit) => {});
    const box = renderDialog(
      async (q) => {
        calls.push(q);
        return { hits: [CONTENT_HIT], truncated: false };
      },
      { onOpenContent },
    );
    type(box, '合');
    type(box, '合意');
    const content = await screen.findByRole('region', { name: '中身の当たり' });
    // 打つたびではなく、打ち終わった検索語で 1 度だけ引く
    expect(calls).toEqual(['合意']);
    expect(content.textContent).toContain('議事録 / Sheet 1');
    fireEvent.click(content.querySelector('button') as HTMLButtonElement);
    expect(onOpenContent.mock.calls[0]?.[0]).toEqual(CONTENT_HIT);
  });

  test('打ち切ったら、そう言う', async () => {
    const box = renderDialog(async () => ({
      hits: [CONTENT_HIT],
      truncated: true,
    }));
    type(box, '合意');
    const content = await screen.findByRole('region', { name: '中身の当たり' });
    expect(content.textContent).toContain('多すぎるので途中まで');
  });

  test('遅れて届いた古い検索語の結果は出さない', async () => {
    const pending: ((r: FileSearchResult) => void)[] = [];
    const box = renderDialog(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    );
    type(box, '合意');
    await waitFor(() => expect(pending).toHaveLength(1));
    type(box, '保留');
    await waitFor(() => expect(pending).toHaveLength(2));
    // 古い方が後から届く
    await act(async () => {
      pending[1]?.({ hits: [], truncated: false });
      pending[0]?.({ hits: [CONTENT_HIT], truncated: false });
    });
    expect(screen.queryByRole('region', { name: '中身の当たり' })).toBeNull();
    expect(screen.getByText('「保留」に当たるものはありません')).toBeTruthy();
  });
});
