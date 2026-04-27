import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

const { render, screen, fireEvent, cleanup } = await import(
  '@testing-library/react'
);
const { ConfirmDialog } = await import('./ConfirmDialog');

const mockOnConfirm = mock(() => {});
const mockOnCancel = mock(() => {});

beforeEach(() => {
  mockOnConfirm.mockClear();
  mockOnCancel.mockClear();
});

afterEach(() => {
  cleanup();
});

function renderDialog(message = '実行しますか？') {
  return render(
    <ConfirmDialog
      message={message}
      onConfirm={mockOnConfirm}
      onCancel={mockOnCancel}
    />,
  );
}

function getBackdrop() {
  const d = screen.getByRole('dialog');
  const backdrop = d.parentElement;
  if (!backdrop) throw new Error('backdrop not found');
  return backdrop;
}

describe('ConfirmDialog', () => {
  it('メッセージが表示される', () => {
    renderDialog('branch "test" を merge しますか？');
    expect(screen.getByText('branch "test" を merge しますか？')).toBeTruthy();
  });

  it('改行を含むメッセージが表示される', () => {
    renderDialog('削除しますか？\nこの操作は取り消せません。');
    expect(screen.getByText(/削除しますか？/)).toBeTruthy();
    expect(screen.getByText(/この操作は取り消せません/)).toBeTruthy();
  });

  it('OK ボタンクリックで onConfirm が呼ばれる', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(mockOnConfirm).toHaveBeenCalledTimes(1);
    expect(mockOnCancel).not.toHaveBeenCalled();
  });

  it('キャンセルボタンクリックで onCancel が呼ばれる', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(mockOnCancel).toHaveBeenCalledTimes(1);
    expect(mockOnConfirm).not.toHaveBeenCalled();
  });

  it('confirmLabel / cancelLabel のカスタマイズが効く', () => {
    render(
      <ConfirmDialog
        message="削除しますか？"
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
        confirmLabel="削除する"
        cancelLabel="戻る"
      />,
    );
    expect(screen.getByRole('button', { name: '削除する' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '戻る' })).toBeTruthy();
  });

  it('Escape キーで onCancel が呼ばれる', () => {
    renderDialog();
    fireEvent.keyDown(getBackdrop(), { key: 'Escape' });
    expect(mockOnCancel).toHaveBeenCalledTimes(1);
  });

  it('背景クリックで onCancel が呼ばれる', () => {
    renderDialog();
    fireEvent.click(getBackdrop());
    expect(mockOnCancel).toHaveBeenCalledTimes(1);
  });

  it('ダイアログ内部クリックでは onCancel が呼ばれない', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('dialog'));
    expect(mockOnCancel).not.toHaveBeenCalled();
  });

  it('aria-modal が設定されている', () => {
    renderDialog();
    const d = screen.getByRole('dialog');
    expect(d.getAttribute('aria-modal')).toBe('true');
  });
});
