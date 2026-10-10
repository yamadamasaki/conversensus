import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GraphHeader, type HeaderBranch } from './GraphHeader';
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

function renderHeader(compact: boolean, c = controls()) {
  render(
    <GraphHeader
      controls={c}
      groupAbility={NO_GROUP_ABILITY}
      searchOpen={false}
      onToggleSearch={noop}
      propertyOpen={false}
      onToggleProperty={noop}
      branch={BRANCH}
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
    // branch の名前は tooltip に退け、変更の数だけを残す
    expect(screen.queryByText(/b1/)).toBeNull();
    expect(screen.getByTitle('b1').textContent).toContain('(2 変更)');
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
