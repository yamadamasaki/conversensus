import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import {
  STORAGE_AT_RISK_LABEL,
  StorageAtRiskBanner,
} from './StorageAtRiskBanner';

afterEach(cleanup);

describe('StorageAtRiskBanner (#263)', () => {
  test('この端末だけの File の数と、消されうることを出す', () => {
    render(<StorageAtRiskBanner count={2} signedIn />);
    const banner = screen.getByRole('note', { name: STORAGE_AT_RISK_LABEL });
    expect(banner.textContent).toContain('2 件');
    expect(banner.textContent).toContain('消すことがあります');
  });

  test('ログイン中は File の詳細からの保存を、未ログインならログインを勧める', () => {
    render(<StorageAtRiskBanner count={1} signedIn />);
    expect(screen.getByRole('note').textContent).toContain(
      'アカウントに保存する',
    );
    cleanup();
    render(<StorageAtRiskBanner count={1} signedIn={false} />);
    expect(screen.getByRole('note').textContent).toContain('ログインして');
  });

  test('この端末だけの File が無ければ何も出さない', () => {
    const { container } = render(<StorageAtRiskBanner count={0} signedIn />);
    expect(container.textContent).toBe('');
  });
});
