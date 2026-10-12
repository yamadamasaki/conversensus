import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  GraphHeader,
  type HeaderBranch,
  type HeaderTitle,
} from './GraphHeader';
import type { GraphEditorControls } from './graph/editorControls';
import { NO_GROUP_ABILITY } from './hooks/useGroupNodes';

afterEach(() => {
  cleanup();
});

const noop = () => {};

function controls(): GraphEditorControls {
  return { exportPng: mock(noop) } as unknown as GraphEditorControls;
}

const BRANCH: HeaderBranch = {
  name: 'b1',
  merged: false,
  pendingCount: 2,
  canMerge: false,
  onCommit: noop,
  onMerge: noop,
};

const TITLE: HeaderTitle = {
  fileName: '研究',
  sheetName: 'Sheet 1',
  merger: false,
};

function renderHeader(
  compact: boolean,
  c = controls(),
  branch: HeaderBranch | null = BRANCH,
  title: HeaderTitle = TITLE,
) {
  render(
    <GraphHeader
      controls={c}
      title={title}
      groupAbility={NO_GROUP_ABILITY}
      searchOpen={false}
      onToggleSearch={noop}
      propertyOpen={false}
      onToggleProperty={noop}
      branch={branch}
      compact={compact}
    />,
  );
  return c;
}

describe('GraphHeader の狭い画面 (visual language §9.2)', () => {
  test('広い画面では文字のボタンが文字を持つ', () => {
    renderHeader(false);
    expect(screen.getByRole('button', { name: 'commit' }).textContent).toBe(
      'commit',
    );
    expect(screen.getByText(/b1/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'PNG で書き出す' })).toBeTruthy();
  });

  test('狭い画面では記号だけになり、名前は aria-label と tooltip に残る', () => {
    renderHeader(true);
    const commit = screen.getByRole('button', { name: 'commit' });
    expect(commit.textContent).toBe('');
    expect(commit.getAttribute('title')).toBe('commit');
    expect(
      screen.getByRole('button', { name: 'group にまとめる' }).textContent,
    ).toBe('');
    // branch と File の名前は tooltip に退け、Sheet の名前と変更の数は残す
    expect(screen.queryByText(/b1/)).toBeNull();
    expect(screen.getByTitle('b1')).toBeTruthy();
    expect(screen.queryByText(/研究/)).toBeNull();
    expect(screen.getByText('Sheet 1')).toBeTruthy();
    expect(screen.getByText('2 変更')).toBeTruthy();
  });

  test('狭い画面では PNG を「その他の操作」のメニューに入れる', () => {
    const c = renderHeader(true);
    expect(screen.queryByRole('button', { name: 'PNG で書き出す' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'その他の操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'PNG で書き出す' }));
    expect(c.exportPng).toHaveBeenCalledTimes(1);
    // 選んだらメニューは閉じる
    expect(screen.queryByRole('menu', { name: 'その他の操作' })).toBeNull();
  });
});

describe('GraphHeader の名前と状態 (#276)', () => {
  test('File と Sheet の名前を出し、全体を tooltip に持つ', () => {
    renderHeader(false, controls(), null);
    expect(screen.getByText('Sheet 1')).toBeTruthy();
    expect(screen.getByTitle('研究 / Sheet 1')).toBeTruthy();
  });

  test('branch でなければ trunk と言う', () => {
    renderHeader(false, controls(), null);
    expect(screen.getByText('trunk')).toBeTruthy();
  });

  test('branch なら名前と未 commit の変更の数を言う', () => {
    renderHeader(false);
    expect(screen.getByText('b1')).toBeTruthy();
    expect(screen.getByTitle('まだ commit していない変更').textContent).toBe(
      '2 変更',
    );
  });

  test('変更が無ければ数を出さず、merge 済みならそう言う', () => {
    renderHeader(false, controls(), {
      ...BRANCH,
      pendingCount: 0,
      merged: true,
    });
    expect(screen.queryByTitle('まだ commit していない変更')).toBeNull();
    expect(screen.getByText('(merged)')).toBeTruthy();
  });

  test('merger のタブでは merge と言う', () => {
    renderHeader(false, controls(), null, { ...TITLE, merger: true });
    expect(screen.getByText('merge')).toBeTruthy();
    expect(screen.queryByText('trunk')).toBeNull();
  });
});

describe('GraphHeader のリンクを写すボタン (#251)', () => {
  function renderWithCopy(onCopyLink?: () => Promise<void>) {
    render(
      <GraphHeader
        controls={controls()}
        title={TITLE}
        groupAbility={NO_GROUP_ABILITY}
        searchOpen={false}
        onToggleSearch={noop}
        propertyOpen={false}
        onToggleProperty={noop}
        branch={null}
        onCopyLink={onCopyLink}
      />,
    );
  }

  test('渡さなければ出さない', () => {
    renderWithCopy();
    expect(
      screen.queryByRole('button', { name: 'この view のリンクを写す' }),
    ).toBeNull();
  });

  test('写せたら、少しの間「写しました」と知らせる', async () => {
    const onCopyLink = mock(() => Promise.resolve());
    renderWithCopy(onCopyLink);
    fireEvent.click(
      screen.getByRole('button', { name: 'この view のリンクを写す' }),
    );
    expect(onCopyLink).toHaveBeenCalledTimes(1);
    await screen.findByRole('button', { name: 'リンクを写しました' });
  });

  test('写せなければ「写しました」とは言わない', async () => {
    renderWithCopy(() => Promise.reject(new Error('denied')));
    fireEvent.click(
      screen.getByRole('button', { name: 'この view のリンクを写す' }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      screen.queryByRole('button', { name: 'リンクを写しました' }),
    ).toBeNull();
  });
});

describe('GraphHeader の map の on/off (#182)', () => {
  function renderWithMap(mapOpen?: boolean, onToggleMap?: () => void) {
    render(
      <GraphHeader
        controls={controls()}
        title={TITLE}
        groupAbility={NO_GROUP_ABILITY}
        searchOpen={false}
        onToggleSearch={noop}
        propertyOpen={false}
        onToggleProperty={noop}
        mapOpen={mapOpen}
        onToggleMap={onToggleMap}
        branch={null}
      />,
    );
  }

  test('渡さなければ出さない', () => {
    renderWithMap();
    expect(screen.queryByRole('button', { name: 'map' })).toBeNull();
  });

  test('出ているかを押された状態で示し、押せば切り替えを頼む', () => {
    const onToggleMap = mock(noop);
    renderWithMap(true, onToggleMap);
    const button = screen.getByRole('button', { name: 'map' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button);
    expect(onToggleMap).toHaveBeenCalledTimes(1);
  });
});

describe('GraphHeader の過去の時点 (#73)', () => {
  test('流れと「過去の時点 · 読み取り専用」を言う', () => {
    renderHeader(false, controls(), null, {
      ...TITLE,
      past: { branchName: 'b1' },
    });
    expect(screen.getByText('b1')).toBeTruthy();
    expect(screen.getByText('過去の時点 · 読み取り専用')).toBeTruthy();
  });

  test('trunk の時点なら trunk と言う', () => {
    renderHeader(false, controls(), null, {
      ...TITLE,
      past: { branchName: null },
    });
    expect(screen.getByText('trunk')).toBeTruthy();
  });
});
