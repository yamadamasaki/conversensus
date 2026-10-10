import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { Files } from 'lucide-react';
import { EmptyState } from './EmptyState';

afterEach(() => {
  cleanup();
});

describe('EmptyState', () => {
  test('題が領域の名前と見出しになり、本文と操作の口が出る', () => {
    render(
      <EmptyState
        icon={Files}
        title="File がありません"
        actions={<button type="button">File を作る</button>}
      >
        新しく作ってください
      </EmptyState>,
    );
    const region = screen.getByRole('region', { name: 'File がありません' });
    expect(
      screen.getByRole('heading', { name: 'File がありません' }),
    ).toBeTruthy();
    expect(region.textContent).toContain('新しく作ってください');
    expect(screen.getByRole('button', { name: 'File を作る' })).toBeTruthy();
    // アイコンは飾り。読み上げない
    expect(region.querySelector('svg')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });

  test('本文と操作が無ければ、その枠ごと出さない', () => {
    render(<EmptyState title="File を開いてください" />);
    const region = screen.getByRole('region', {
      name: 'File を開いてください',
    });
    expect(region.querySelector('p')).toBeNull();
    expect(region.querySelector('button')).toBeNull();
  });
});
