import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SidePanel } from './SidePanel';

afterEach(() => {
  cleanup();
});

const OPEN = { width: 240, collapsed: false };
const noop = () => {};

describe('SidePanel の重ねる出し方 (visual language §9.2)', () => {
  test('並べるときはボディと同じ流れに置く', () => {
    render(
      <SidePanel
        side="left"
        label="左"
        state={OPEN}
        onResize={noop}
        onToggle={noop}
      >
        <p>中身</p>
      </SidePanel>,
    );
    const panel = screen.getByText('中身').parentElement;
    expect(panel?.style.position).toBe('relative');
  });

  test('重ねるときは浮かせ、広げるボタンは 1 つだけにする', () => {
    render(
      <SidePanel
        side="left"
        label="左"
        state={OPEN}
        mode="overlay"
        onResize={noop}
        onToggle={noop}
      >
        <p>中身</p>
      </SidePanel>,
    );
    const panel = screen.getByText('中身').parentElement;
    expect(panel?.style.position).toBe('absolute');
    // 並べて残す帯は、開いている間はボタンを持たない (畳むボタンだけが押せる)
    expect(screen.queryByRole('button', { name: '左を広げる' })).toBeNull();
    expect(screen.getByRole('button', { name: '左を畳む' })).toBeTruthy();
  });

  test('onDismiss を渡したときだけ外側に幕を敷き、押すと閉じる', () => {
    const onDismiss = mock(noop);
    const { container } = render(
      <SidePanel
        side="left"
        label="左"
        state={OPEN}
        mode="overlay"
        onDismiss={onDismiss}
        onResize={noop}
        onToggle={noop}
      >
        <p>中身</p>
      </SidePanel>,
    );
    const scrim = container.querySelector('[aria-hidden="true"]');
    if (!scrim) throw new Error('scrim not found');
    fireEvent.click(scrim);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  test('畳んでいれば、重ねるときも帯と広げるボタンだけを出す', () => {
    render(
      <SidePanel
        side="right"
        label="右"
        state={{ width: 240, collapsed: true }}
        mode="overlay"
        onResize={noop}
        onToggle={noop}
      >
        <p>中身</p>
      </SidePanel>,
    );
    expect(screen.queryByText('中身')).toBeNull();
    expect(screen.getByRole('button', { name: '右を広げる' })).toBeTruthy();
  });
});
