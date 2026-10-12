import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { NameHighlight } from './NameHighlight';

afterEach(cleanup);

describe('NameHighlight (#249)', () => {
  test('当たった部分だけを mark で囲み、ボタンの名前は元の名前のまま', () => {
    render(
      <button type="button">
        <NameHighlight name="議事録" query="議事" />
      </button>,
    );
    const button = screen.getByRole('button', { name: '議事録' });
    expect(button.querySelector('mark')?.textContent).toBe('議事');
  });

  test('当たらなければ名前をそのまま出す', () => {
    const { container } = render(<NameHighlight name="設計" query="議事" />);
    expect(container.textContent).toBe('設計');
    expect(container.querySelector('mark')).toBeNull();
  });

  test('名前は利用者が付けたものなので、ブラウザの自動翻訳に書き換えさせない (#50)', () => {
    const { container } = render(<NameHighlight name="議事録" query="議事" />);
    expect(container.querySelector('[translate="no"]')?.textContent).toBe(
      '議事録',
    );
  });
});
