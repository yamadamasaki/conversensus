import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

const { render, screen, fireEvent, cleanup } = await import(
  '@testing-library/react'
);
const { AlertDialog } = await import('./AlertDialog');

const mockOnClose = mock(() => {});

beforeEach(() => {
  mockOnClose.mockClear();
});

afterEach(() => {
  cleanup();
});

function renderDialog(message = 'エラーが発生しました') {
  return render(<AlertDialog message={message} onClose={mockOnClose} />);
}

function getBackdrop() {
  const d = screen.getByRole('alertdialog');
  const backdrop = d.parentElement;
  if (!backdrop) throw new Error('backdrop not found');
  return backdrop;
}

describe('AlertDialog', () => {
  it('メッセージが表示される', () => {
    renderDialog('merge に失敗しました。');
    expect(screen.getByText('merge に失敗しました。')).toBeTruthy();
  });

  it('OK ボタンクリックで onClose が呼ばれる', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('Escape キーで onClose が呼ばれる', () => {
    renderDialog();
    fireEvent.keyDown(getBackdrop(), { key: 'Escape' });
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('背景クリックで onClose が呼ばれる', () => {
    renderDialog();
    fireEvent.click(getBackdrop());
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('closeLabel のカスタマイズが効く', () => {
    render(
      <AlertDialog
        message="完了しました"
        onClose={mockOnClose}
        closeLabel="閉じる"
      />,
    );
    expect(screen.getByRole('button', { name: '閉じる' })).toBeTruthy();
  });

  it('role="alertdialog" が設定されている', () => {
    renderDialog();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('aria-modal が設定されている', () => {
    renderDialog();
    const d = screen.getByRole('alertdialog');
    expect(d.getAttribute('aria-modal')).toBe('true');
  });
});
