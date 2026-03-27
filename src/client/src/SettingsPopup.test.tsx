import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

const { render, screen, fireEvent, cleanup } = await import(
  '@testing-library/react'
);
const { SettingsPopup } = await import('./SettingsPopup');

const mockOnSave = mock((_name: string, _desc: string) => {});
const mockOnDelete = mock(() => {});
const mockOnClose = mock(() => {});

beforeEach(() => {
  mockOnSave.mockClear();
  mockOnDelete.mockClear();
  mockOnClose.mockClear();
});

afterEach(() => {
  cleanup();
});

function renderPopup(overrides?: { name?: string; description?: string }) {
  return render(
    <SettingsPopup
      name={overrides?.name ?? 'テスト'}
      description={overrides?.description ?? '概要テスト'}
      onSave={mockOnSave}
      onDelete={mockOnDelete}
      onClose={mockOnClose}
      deleteLabel="削除"
    />,
  );
}

describe('SettingsPopup', () => {
  it('name と description の初期値が表示される', () => {
    renderPopup({ name: 'マイファイル', description: 'これは概要です' });
    expect(
      (screen.getByRole('textbox', { name: '名前' }) as HTMLInputElement).value,
    ).toBe('マイファイル');
    expect(
      (screen.getByRole('textbox', { name: '概要' }) as HTMLTextAreaElement)
        .value,
    ).toBe('これは概要です');
  });

  it('保存ボタンで onSave と onClose が呼ばれる', () => {
    renderPopup({ name: 'ファイル', description: '説明' });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(mockOnSave).toHaveBeenCalledTimes(1);
    expect(mockOnSave).toHaveBeenCalledWith('ファイル', '説明');
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('名前を変更して保存すると新しい名前で onSave が呼ばれる', () => {
    renderPopup({ name: '古い名前', description: '' });
    fireEvent.change(screen.getByRole('textbox', { name: '名前' }), {
      target: { value: '新しい名前' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(mockOnSave).toHaveBeenCalledWith('新しい名前', '');
  });

  it('名前を空にして保存すると元の名前にフォールバックする', () => {
    renderPopup({ name: '元の名前', description: '' });
    fireEvent.change(screen.getByRole('textbox', { name: '名前' }), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(mockOnSave).toHaveBeenCalledWith('元の名前', '');
  });

  it('Enter キーで保存される', () => {
    renderPopup({ name: 'ファイル', description: '' });
    fireEvent.keyDown(screen.getByRole('textbox', { name: '名前' }), {
      key: 'Enter',
    });
    expect(mockOnSave).toHaveBeenCalledTimes(1);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('IME 変換中の Enter では保存されない', () => {
    renderPopup({ name: 'ファイル', description: '' });
    const input = screen.getByRole('textbox', { name: '名前' });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockOnSave).not.toHaveBeenCalled();
  });

  it('IME 確定後の Enter では保存される', () => {
    renderPopup({ name: 'ファイル', description: '' });
    const input = screen.getByRole('textbox', { name: '名前' });
    fireEvent.compositionStart(input);
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockOnSave).toHaveBeenCalledTimes(1);
  });

  it('Escape キーで onClose が呼ばれる (名前フィールド)', () => {
    renderPopup();
    fireEvent.keyDown(screen.getByRole('textbox', { name: '名前' }), {
      key: 'Escape',
    });
    expect(mockOnClose).toHaveBeenCalledTimes(1);
    expect(mockOnSave).not.toHaveBeenCalled();
  });

  it('Escape キーで onClose が呼ばれる (概要フィールド)', () => {
    renderPopup();
    fireEvent.keyDown(screen.getByRole('textbox', { name: '概要' }), {
      key: 'Escape',
    });
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('削除ボタンで onDelete が呼ばれる', () => {
    renderPopup();
    fireEvent.click(screen.getByRole('button', { name: '削除' }));
    expect(mockOnDelete).toHaveBeenCalledTimes(1);
  });

  it('ポップアップ外のクリックで onSave と onClose が呼ばれる', () => {
    renderPopup({ name: 'ファイル', description: '説明' });
    fireEvent.mouseDown(document.body);
    expect(mockOnSave).toHaveBeenCalledWith('ファイル', '説明');
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });
});
