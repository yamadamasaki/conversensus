import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from 'bun:test';
import {
  BranchIdSchema,
  type FileId,
  FileIdSchema,
  type GraphViewAddress,
  HEAD_CUT,
  SheetIdSchema,
} from '@conversensus/shared';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useViewLink } from './useViewLink';
import { viewHash } from './viewLink';

const FILE = FileIdSchema.parse('00000000-0000-4000-8000-0000000000f1');
const OTHER = FileIdSchema.parse('00000000-0000-4000-8000-0000000000f2');
const SHEET = SheetIdSchema.parse('00000000-0000-4000-8000-0000000000a1');
const BRANCH = BranchIdSchema.parse('00000000-0000-4000-8000-0000000000b1');

const linked: GraphViewAddress = {
  fileId: FILE,
  sheetId: SHEET,
  branchId: BRANCH,
  cut: HEAD_CUT,
};
const elsewhere: GraphViewAddress = {
  fileId: OTHER,
  sheetId: SHEET,
  branchId: null,
  cut: HEAD_CUT,
};

/**
 * happy-dom の既定の URL は `about:blank` で、`replaceState` で fragment を変えられない。
 * このファイルの間だけ http の URL にする (同じプロセスの他のテストへ持ち越さない)
 */
const happyDOM = (
  globalThis as unknown as { happyDOM: { setURL(url: string): void } }
).happyDOM;
beforeAll(() => happyDOM.setURL('http://127.0.0.1:5173/'));
afterAll(() => happyDOM.setURL('about:blank'));

function setHash(hash: string) {
  history.replaceState(null, '', location.pathname + location.search + hash);
}

afterEach(() => {
  cleanup();
  setHash('');
});

type Props = {
  current: GraphViewAddress | null;
  canWrite: boolean;
  filesLoaded: boolean;
  files: readonly FileId[];
};

function render(initial: Props) {
  const open = mock((_: GraphViewAddress) => {});
  const onMissing = mock((_: GraphViewAddress) => {});
  const hook = renderHook(
    (p: Props) =>
      useViewLink({
        current: p.current,
        canWrite: p.canWrite,
        filesLoaded: p.filesLoaded,
        hasFile: (id) => p.files.includes(id),
        open,
        onMissing,
      }),
    { initialProps: initial },
  );
  return { ...hook, open, onMissing };
}

const ready: Props = {
  current: null,
  canWrite: true,
  filesLoaded: true,
  files: [FILE, OTHER],
};

describe('useViewLink (#251)', () => {
  test('起動時の fragment のリンクを開く', () => {
    setHash(viewHash(linked));
    const { open } = render(ready);
    expect(open).toHaveBeenCalledWith(linked);
  });

  test('File の一覧を読み終えるまで開かずに待つ', () => {
    setHash(viewHash(linked));
    const { open, onMissing, rerender } = render({
      ...ready,
      filesLoaded: false,
      files: [],
    });
    expect(open).not.toHaveBeenCalled();
    expect(onMissing).not.toHaveBeenCalled();
    rerender({ ...ready });
    expect(open).toHaveBeenCalledWith(linked);
  });

  test('手元に無い File なら開かずに知らせる', () => {
    setHash(viewHash(linked));
    const { open, onMissing } = render({ ...ready, files: [OTHER] });
    expect(open).not.toHaveBeenCalled();
    expect(onMissing).toHaveBeenCalledWith(linked);
  });

  test('開いた後で貼られたリンク (hashchange) も開く', () => {
    const { open } = render(ready);
    act(() => {
      setHash(viewHash(linked));
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(open).toHaveBeenCalledWith(linked);
  });

  test('いま見ている view に fragment を合わせ、何も開いていなければ外す', () => {
    const { rerender } = render({ ...ready, current: elsewhere });
    expect(location.hash).toBe(viewHash(elsewhere));
    rerender({ ...ready, current: linked });
    expect(location.hash).toBe(viewHash(linked));
    rerender({ ...ready, current: null });
    expect(location.hash).toBe('');
  });

  test('自分で書いた fragment の hashchange は、届いたリンクとして扱わない', () => {
    // replaceState で hashchange を出す実装 (happy-dom) がある。移る途中の姿を書いたときに
    // それを開き直すと、行き先のタブから引き戻してしまう
    const { open } = render({ ...ready, current: elsewhere });
    expect(location.hash).toBe(viewHash(elsewhere));
    act(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(open).not.toHaveBeenCalled();
  });

  test('ログインの戻りを読み終えるまでは fragment に触らない', () => {
    const callback = '#state=abc&iss=x&code=y';
    setHash(callback);
    const { rerender } = render({
      ...ready,
      current: elsewhere,
      canWrite: false,
    });
    expect(location.hash).toBe(callback);
    rerender({ ...ready, current: elsewhere });
    expect(location.hash).toBe(viewHash(elsewhere));
  });

  test('届いたリンクを開くまでは、前の view で上書きしない', () => {
    setHash(viewHash(linked));
    render({ ...ready, current: elsewhere, filesLoaded: false });
    expect(location.hash).toBe(viewHash(linked));
  });
});
