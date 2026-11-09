import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { Did } from '@conversensus/shared';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NodeActionDialog } from './NodeActionDialog';
import type { ActionArgs, LocalizedText, NodeAction } from './nodeAction';

afterEach(() => cleanup());

const ALICE = 'did:plc:alice' as Did;
const BOB = 'did:plc:bob' as Did;
const STRANGER = 'did:plc:stranger' as Did;
const text = (ja: string): LocalizedText => ({ ja, en: ja });

/** 3 つの型の引数を 1 つずつ持つ操作 */
const ACTION: NodeAction = {
  id: 'send',
  label: text('送る'),
  available: () => true,
  params: [
    { name: 'to', kind: 'actors', label: text('宛先') },
    {
      name: 'where',
      kind: 'choice',
      label: text('答えの置き場所'),
      options: [
        { value: 'linkedNode', label: text('新しい node') },
        { value: 'newSheet', label: text('新しい sheet') },
      ],
    },
    {
      name: 'note',
      kind: 'text',
      label: text('添え書き'),
      multiline: true,
      required: true,
    },
  ],
  run: () => {
    throw new Error('dialog は run を呼ばない');
  },
};
const PARTICIPANTS = [
  { did: ALICE, label: 'alice' },
  { did: BOB, label: 'bob' },
];

function renderDialog(
  initial: ActionArgs,
  onSubmit: (args: ActionArgs) => string | undefined = () => undefined,
) {
  const submit = mock(onSubmit);
  const cancel = mock(() => {});
  render(
    <NodeActionDialog
      action={ACTION}
      initial={initial}
      participants={PARTICIPANTS}
      onSubmit={submit}
      onCancel={cancel}
    />,
  );
  return { submit, cancel, user: userEvent.setup() };
}

describe('NodeActionDialog', () => {
  test('見出しは操作の名前で、宣言の型ごとに入力が出て、初めの値が入っている', () => {
    renderDialog({ to: [BOB], where: 'newSheet', note: '前の添え書き' });
    expect(screen.getByRole('dialog', { name: '送る' })).toBeTruthy();
    expect(
      (screen.getByRole('checkbox', { name: 'alice' }) as HTMLInputElement)
        .checked,
    ).toBe(false);
    expect(
      (screen.getByRole('checkbox', { name: 'bob' }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      (screen.getByLabelText('答えの置き場所') as HTMLSelectElement).value,
    ).toBe('newSheet');
    expect(
      (screen.getByLabelText('添え書き') as HTMLTextAreaElement).value,
    ).toBe('前の添え書き');
  });

  test('選び・書いた値を「実行」で返す', async () => {
    const { submit, user } = renderDialog({ to: [], where: 'linkedNode' });
    await user.click(screen.getByRole('checkbox', { name: 'alice' }));
    await user.click(screen.getByRole('checkbox', { name: 'bob' }));
    await user.click(screen.getByRole('checkbox', { name: 'alice' }));
    await user.selectOptions(
      screen.getByLabelText('答えの置き場所'),
      'newSheet',
    );
    await user.type(screen.getByLabelText('添え書き'), '急ぎ');
    await user.click(screen.getByRole('button', { name: '実行' }));
    expect(submit).toHaveBeenCalledWith({
      to: [BOB],
      where: 'newSheet',
      note: '急ぎ',
    });
  });

  test('必須の本文が空 (空白だけ) なら「実行」を押せない', async () => {
    const { submit, user } = renderDialog({ where: 'linkedNode', note: '  ' });
    const run = screen.getByRole('button', {
      name: '実行',
    }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    await user.click(run);
    expect(submit).not.toHaveBeenCalled();
  });

  test('実行できなかった理由は dialog の中に出す (閉じない)', async () => {
    const { user } = renderDialog(
      { where: 'linkedNode', note: 'x' },
      () => '今この node には使えない',
    );
    await user.click(screen.getByRole('button', { name: '実行' }));
    expect(screen.getByRole('alert').textContent).toBe(
      '今この node には使えない',
    );
    expect(screen.getByRole('dialog', { name: '送る' })).toBeTruthy();
  });

  test('選ばれているのに参加者にいない人も出す (外せるように)', async () => {
    const { submit, user } = renderDialog({
      to: [STRANGER],
      where: 'linkedNode',
      note: 'x',
    });
    await user.click(screen.getByRole('checkbox', { name: STRANGER }));
    await user.click(screen.getByRole('button', { name: '実行' }));
    expect(submit).toHaveBeenCalledWith({
      to: [],
      where: 'linkedNode',
      note: 'x',
    });
  });

  test('キャンセルで閉じる', async () => {
    const { cancel, user } = renderDialog({ where: 'linkedNode' });
    await user.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(cancel).toHaveBeenCalled();
  });
});
