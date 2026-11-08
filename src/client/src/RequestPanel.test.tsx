import { describe, expect, mock, test } from 'bun:test';
import type { Did } from '@conversensus/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Participant } from './hooks/useFileParticipants';
import { RequestPanel } from './RequestPanel';
import type { RequestAction, RequestTarget } from './request/requestTarget';

const ALICE = 'did:plc:alice' as Did;
const AGENT = 'did:plc:agent' as Did;
const PARTICIPANTS: Participant[] = [
  { did: AGENT, label: 'agent.test' },
  { did: ALICE, label: 'alice.test' },
];

function renderPanel(request: Partial<RequestTarget>, readOnly = false) {
  const onAction = mock((_: RequestAction) => {});
  render(
    <RequestPanel
      request={{ status: 'draft', sent: 0, addressee: [], ...request }}
      participants={PARTICIPANTS}
      onAction={onAction}
      readOnly={readOnly}
    />,
  );
  return onAction;
}
const buttons = () =>
  within(screen.getByRole('region', { name: '依頼' }))
    .queryAllByRole('button')
    .map((b) => b.textContent);

describe('RequestPanel', () => {
  test('状態ごとに、今できる操作のボタンだけを出す', () => {
    renderPanel({ status: 'draft' });
    expect(buttons()).toEqual(['送る']);
  });

  test.each([
    ['sent', 1],
    ['answered', 2],
  ] as const)('%s: 送り直す・閉じる・答える', (status, sent) => {
    renderPanel({ status, sent });
    expect(buttons()).toEqual(['送り直す', '閉じる', '答える']);
    expect(screen.getByRole('status').textContent).toContain(`${sent} 回目`);
  });

  test('閉じた: 開き直すだけ', () => {
    renderPanel({ status: 'closed', sent: 1 });
    expect(buttons()).toEqual(['開き直す']);
  });

  test('ボタンは操作を渡す', async () => {
    const onAction = renderPanel({ status: 'sent', sent: 1 });
    await userEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(onAction).toHaveBeenLastCalledWith({ kind: 'close' });
  });

  test('宛先が空なら「指定なし」。候補から足すと宛先の列を渡す', async () => {
    const onAction = renderPanel({ addressee: [] });
    expect(screen.getByText('指定なし (参加者全員)')).toBeDefined();
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: '宛先を足す' }),
      AGENT,
    );
    expect(onAction).toHaveBeenLastCalledWith({
      kind: 'setAddressee',
      dids: [AGENT],
    });
  });

  test('宛先はハンドル名で出し、× で外す。候補には宛先に入っていない人だけが出る', async () => {
    const onAction = renderPanel({ addressee: [AGENT, ALICE] });
    expect(screen.getByRole('list', { name: '宛先' }).textContent).toContain(
      'agent.test',
    );
    expect(screen.queryByRole('combobox', { name: '宛先を足す' })).toBeNull();
    await userEvent.click(
      screen.getByRole('button', { name: 'agent.test を宛先から外す' }),
    );
    expect(onAction).toHaveBeenLastCalledWith({
      kind: 'setAddressee',
      dids: [ALICE],
    });
  });

  test('答えは書いてから押す。空では押せず、押すと書いた本文を渡して欄を空にする', async () => {
    const onAction = renderPanel({ status: 'sent', sent: 1 });
    const answer = screen.getByRole('button', { name: '答える' });
    expect((answer as HTMLButtonElement).disabled).toBe(true);
    const box = screen.getByRole('textbox', { name: '答えを書く' });
    await userEvent.type(box, '要約です');
    await userEvent.click(answer);
    expect(onAction).toHaveBeenLastCalledWith({
      kind: 'answer',
      content: '要約です',
    });
    expect((box as HTMLTextAreaElement).value).toBe('');
  });

  test('読み取り専用では、状態と宛先だけを出す', () => {
    renderPanel({ status: 'sent', sent: 1, addressee: [AGENT] }, true);
    expect(buttons()).toEqual([]);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('送った・未回答');
  });
});
