import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LOCAL_ONLY_BANNER_LABEL, LocalOnlyBanner } from './LocalOnlyBanner';

afterEach(cleanup);

describe('LocalOnlyBanner (FPR 前 L-3)', () => {
  test('この端末にだけある編集の件数と、ログインすると送られることを出す', () => {
    render(<LocalOnlyBanner count={3} onLogin={() => {}} />);
    const banner = screen.getByRole('button', {
      name: LOCAL_ONLY_BANNER_LABEL,
    });
    expect(banner.textContent).toContain('3 件');
    expect(banner.textContent).toContain('ログインすると送られます');
  });

  test('押すとログインを始める', () => {
    const onLogin = mock(() => {});
    render(<LocalOnlyBanner count={1} onLogin={onLogin} />);
    fireEvent.click(
      screen.getByRole('button', { name: LOCAL_ONLY_BANNER_LABEL }),
    );
    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  test('0 件なら何も出さない', () => {
    const { container } = render(
      <LocalOnlyBanner count={0} onLogin={() => {}} />,
    );
    expect(container.textContent).toBe('');
  });
});
