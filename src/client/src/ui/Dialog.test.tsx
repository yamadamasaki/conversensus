import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Dialog, DialogActions, type DialogKind } from './Dialog';

afterEach(() => {
  cleanup();
});

function renderDialog(kind: DialogKind) {
  const onDismiss = mock(() => {});
  render(
    <Dialog kind={kind} label="試し" title="見出し" onDismiss={onDismiss}>
      <p>中身</p>
    </Dialog>,
  );
  const panel = screen.getByLabelText('試し');
  const backdrop = panel.parentElement;
  if (!backdrop) throw new Error('backdrop not found');
  return { onDismiss, panel, backdrop };
}

describe('Dialog の閉じ方は型で決まる (§6.1)', () => {
  test('確認は外側のクリックで閉じない', () => {
    const { onDismiss, backdrop } = renderDialog('confirm');
    fireEvent.click(backdrop);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  test.each(['input', 'alert'] as const)(
    '%s は外側のクリックで閉じる',
    (kind) => {
      const { onDismiss, backdrop } = renderDialog(kind);
      fireEvent.click(backdrop);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    },
  );

  test.each(['confirm', 'input', 'alert'] as const)(
    '%s は Esc で閉じる',
    (kind) => {
      const { onDismiss, panel } = renderDialog(kind);
      fireEvent.keyDown(panel, { key: 'Escape' });
      expect(onDismiss).toHaveBeenCalledTimes(1);
    },
  );

  test('中身のクリックでは閉じない', () => {
    const { onDismiss } = renderDialog('input');
    fireEvent.click(screen.getByText('中身'));
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('Dialog の読み上げ', () => {
  test('知らせは alertdialog、ほかは dialog として読まれる', () => {
    renderDialog('alert');
    expect(screen.getByRole('alertdialog', { name: '試し' })).toBeTruthy();
    cleanup();
    renderDialog('input');
    expect(screen.getByRole('dialog', { name: '試し' })).toBeTruthy();
  });

  test('title は見出しとして出る', () => {
    renderDialog('input');
    expect(screen.getByRole('heading', { name: '見出し' })).toBeTruthy();
  });
});

describe('DialogActions (§6.2)', () => {
  test('破壊的な操作は左端、渡した順のボタンは右に寄せて並ぶ', () => {
    render(
      <DialogActions destructive={<button type="button">削除</button>}>
        <button type="button">キャンセル</button>
        <button type="button">OK</button>
      </DialogActions>,
    );
    const names = screen.getAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual(['削除', 'キャンセル', 'OK']);
    const ok = screen.getByRole('button', { name: 'OK' });
    expect(ok.parentElement?.style.marginLeft).toBe('auto');
  });
});
