import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TabBar } from './TabBar';
import type { Tab, TabId } from './tabs/tabs';

afterEach(() => {
  cleanup();
});

const tab = (id: string): Tab => ({ id: id as TabId, panes: [], active: 0 });
const TABS = [tab('a'), tab('b')];
const LABELS: Record<string, string> = {
  a: '研究 / Sheet 1',
  b: '研究 / Sheet 2',
};
const noop = () => {};

function renderBar(activeId = 'b' as TabId) {
  return render(
    <TabBar
      tabs={TABS}
      activeId={activeId}
      labelOf={(t) => LABELS[t.id] ?? ''}
      onActivate={noop}
      onClose={noop}
    />,
  );
}

describe('TabBar (#277)', () => {
  test('アクティブなタブだけが選ばれていると読まれ、見た目の印を持つ', () => {
    renderBar();
    const active = screen.getByRole('tab', { name: '研究 / Sheet 2' });
    expect(active.getAttribute('aria-selected')).toBe('true');
    expect(active.parentElement?.dataset.active).toBe('true');
    const other = screen.getByRole('tab', { name: '研究 / Sheet 1' });
    expect(other.parentElement?.dataset.active).toBe('false');
  });

  test('名前の全体を tooltip に持つ (縮んで省略されても読める)', () => {
    renderBar();
    expect(
      screen.getByRole('tab', { name: '研究 / Sheet 1' }).getAttribute('title'),
    ).toBe('研究 / Sheet 1');
  });

  test('タブは縮むが、下限の幅を持つ', () => {
    renderBar();
    const frame = screen.getByRole('tab', { name: '研究 / Sheet 1' })
      .parentElement as HTMLElement;
    expect(frame.style.flex).toBe('0 1 200px');
    expect(frame.style.minWidth).toBe('96px');
  });

  test('縦のホイールを横の送りに読み替える', () => {
    renderBar();
    const bar = screen.getByRole('tablist');
    fireEvent.wheel(bar, { deltaY: 40 });
    expect(bar.scrollLeft).toBe(40);
  });

  test('アクティブなタブが変わると見える所まで寄せる', () => {
    const scrolled = mock(noop);
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrolled;
    try {
      const { rerender } = renderBar('a' as TabId);
      scrolled.mockClear();
      rerender(
        <TabBar
          tabs={TABS}
          activeId={'b' as TabId}
          labelOf={(t) => LABELS[t.id] ?? ''}
          onActivate={noop}
          onClose={noop}
        />,
      );
      expect(scrolled).toHaveBeenCalledTimes(1);
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});
