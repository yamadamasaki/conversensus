import { describe, expect, test } from 'bun:test';
import { render, screen } from '@testing-library/react';
import { Search } from 'lucide-react';
import { Button, IconButton } from './Button';

describe('IconButton', () => {
  test('label が名前 (aria-label) と tooltip (title) の両方になる', () => {
    render(<IconButton icon={Search} label="このシートを検索" />);
    const button = screen.getByRole('button', { name: 'このシートを検索' });
    expect(button.getAttribute('title')).toBe('このシートを検索');
    // アイコンは読み上げない (名前は label が持つ)
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });

  test('aria-pressed が渡ればトグルとして読まれる', () => {
    render(<IconButton icon={Search} label="検索" aria-pressed />);
    expect(
      screen.getByRole('button', { name: '検索', pressed: true }),
    ).toBeDefined();
  });
});

describe('Button', () => {
  test('種類を class で持つ (見た目は index.css の .cs-btn--*)', () => {
    render(
      <>
        <Button variant="primary">OK</Button>
        <Button>キャンセル</Button>
        <Button variant="plain">グループ化</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'OK' }).className).toBe(
      'cs-btn cs-btn--primary',
    );
    expect(screen.getByRole('button', { name: 'キャンセル' }).className).toBe(
      'cs-btn cs-btn--secondary',
    );
    expect(screen.getByRole('button', { name: 'グループ化' }).className).toBe(
      'cs-btn',
    );
  });

  test('type は button に固定する (form の中で submit にしない)', () => {
    render(<Button>押す</Button>);
    expect(
      screen.getByRole('button', { name: '押す' }).getAttribute('type'),
    ).toBe('button');
  });
});
