import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AtprotoLoginDialog } from './AtprotoLoginDialog';

afterEach(cleanup);

describe('AtprotoLoginDialog', () => {
  it('🔴 OAuth ではパスワード欄を出さず、handle だけで始める', async () => {
    // パスワードは PDS のページで入れる。このアプリに入れさせると、OAuth にした意味が無い
    const onLogin = mock(async (_h: string, _p?: string) => {});
    render(
      <AtprotoLoginDialog
        needsPassword={false}
        onLogin={onLogin}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByLabelText('パスワード')).toBeNull();
    expect(screen.getByText(/PDS のページへ移ってログイン/)).toBeDefined();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('ハンドル'), 'alice.test');
    await user.click(screen.getByRole('button', { name: 'ログイン' }));
    expect(onLogin).toHaveBeenCalledWith('alice.test', undefined);
  });

  it('パスワードの認証 (App 結合テスト) では、パスワードが無いと押せない', async () => {
    const onLogin = mock(async (_h: string, _p?: string) => {});
    render(
      <AtprotoLoginDialog
        needsPassword
        onLogin={onLogin}
        onCancel={() => {}}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('ハンドル'), 'alice.test');
    const button = screen.getByRole('button', { name: 'ログイン' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText('パスワード'), 'pw');
    await user.click(button);
    expect(onLogin).toHaveBeenCalledWith('alice.test', 'pw');
  });

  it('OAuth を始められなかったら、handle を確かめるよう出す', async () => {
    const onLogin = mock(async () => {
      throw new Error('resolve failed');
    });
    render(
      <AtprotoLoginDialog
        needsPassword={false}
        onLogin={onLogin}
        onCancel={() => {}}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('ハンドル'), 'nobody.test');
    await user.click(screen.getByRole('button', { name: 'ログイン' }));
    await waitFor(() =>
      expect(screen.getByText(/ハンドルを確認してください/)).toBeDefined(),
    );
  });
});
