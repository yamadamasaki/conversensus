import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

const { render, screen, fireEvent, cleanup } = await import(
  '@testing-library/react'
);
const { InputDialog } = await import('./InputDialog');

const mockOnSubmit = mock((_value: string) => {});
const mockOnCancel = mock(() => {});

beforeEach(() => {
  mockOnSubmit.mockClear();
  mockOnCancel.mockClear();
});

afterEach(() => {
  cleanup();
});

function renderDialog(message = '名前を入力してください:') {
  return render(
    <InputDialog
      message={message}
      onSubmit={mockOnSubmit}
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

describe('InputDialog', () => {
  it('メッセージがラベルとして表示される', () => {
    renderDialog('branch 名を入力してください:');
    expect(screen.getByLabelText('branch 名を入力してください:')).toBeTruthy();
  });

  it('入力フィールドにフォーカスされる', () => {
    renderDialog();
    expect(screen.getByRole('textbox') === document.activeElement).toBe(true);
  });

  it('初期値を設定できる', () => {
    render(
      <InputDialog
        message="名前:"
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
        initialValue="初期値"
      />,
    );
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(
      '初期値',
    );
  });

  it('OK ボタンクリックで onSubmit が入力値とともに呼ばれる', () => {
    renderDialog();
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'feature-x' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    expect(mockOnSubmit).toHaveBeenCalledWith('feature-x');
  });

  it('空文字列では OK ボタンが無効', () => {
    renderDialog();
    const btn = screen.getByRole('button', { name: 'OK' });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('空白のみの入力では OK ボタンが無効', () => {
    renderDialog();
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '   ' },
    });
    const btn = screen.getByRole('button', { name: 'OK' });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('Enter キーで onSubmit が呼ばれる', () => {
    renderDialog();
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'feature-y' },
    });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    expect(mockOnSubmit).toHaveBeenCalledWith('feature-y');
  });

  it('IME 変換中の Enter では onSubmit が呼ばれない', () => {
    renderDialog();
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'にほんご' } });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('IME 確定後の Enter では onSubmit が呼ばれる', () => {
    renderDialog();
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'にほんご' } });
    fireEvent.compositionStart(input);
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockOnSubmit).toHaveBeenCalledTimes(1);
  });

  it('キャンセルボタンクリックで onCancel が呼ばれる', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(mockOnCancel).toHaveBeenCalledTimes(1);
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
});
