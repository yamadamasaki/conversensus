import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { UPDATE_NOTICE_LABEL, UpdateNotice } from './UpdateNotice';

afterEach(cleanup);

describe('UpdateNotice (#262)', () => {
  test('新しい版があることと、再読み込みで切り替わることを出す', () => {
    render(<UpdateNotice available onReload={() => {}} onDismiss={() => {}} />);
    const notice = screen.getByRole('status', { name: UPDATE_NOTICE_LABEL });
    expect(notice.textContent).toContain('新しい版があります');
  });

  test('「再読み込み」で読み直し、「あとで」で閉じる', () => {
    const onReload = mock(() => {});
    const onDismiss = mock(() => {});
    render(
      <UpdateNotice available onReload={onReload} onDismiss={onDismiss} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(onReload).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'あとで' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  test('新しい版が無ければ何も出さない', () => {
    const { container } = render(
      <UpdateNotice
        available={false}
        onReload={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(container.textContent).toBe('');
  });
});
