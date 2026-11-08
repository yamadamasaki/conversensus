import { describe, expect, mock, test } from 'bun:test';
import type { Did, FileId, NodeId, SheetId } from '@conversensus/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequestNotice } from './RequestNotice';
import type { RequestArrival } from './sync/requestArrival';

const arrival = (content: string, sent = 1): RequestArrival => ({
  fileId: '11111111-1111-4111-8111-111111111111' as FileId,
  sheetId: '22222222-2222-4222-8222-222222222222' as SheetId,
  nodeId: '33333333-3333-4333-8333-333333333333' as NodeId,
  sent,
  content,
  from: 'did:plc:alice' as Did,
});
const labelOf = (did: Did) => (did === 'did:plc:alice' ? 'alice.test' : did);

describe('RequestNotice', () => {
  test('届いていなければ何も描かない', () => {
    const { container } = render(
      <RequestNotice
        arrivals={[]}
        labelOf={labelOf}
        onOpen={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  test('送り手のハンドル名と本文の抜粋を出し、長い本文は切る', () => {
    render(
      <RequestNotice
        arrivals={[arrival(`この章を\\n${'あ'.repeat(100)}`)]}
        labelOf={labelOf}
        onOpen={() => {}}
        onDismiss={() => {}}
      />,
    );
    const notice = screen.getByRole('status', { name: '届いた依頼' });
    expect(notice.textContent).toContain('alice.test から依頼が届きました');
    expect(notice.textContent).toContain('…');
  });

  test('開く・閉じるは、その依頼を渡す', async () => {
    const onOpen = mock((_: RequestArrival) => {});
    const onDismiss = mock((_: RequestArrival) => {});
    const a = arrival('要約して');
    render(
      <RequestNotice
        arrivals={[a]}
        labelOf={labelOf}
        onOpen={onOpen}
        onDismiss={onDismiss}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: '開く' }));
    expect(onOpen).toHaveBeenLastCalledWith(a);
    await userEvent.click(
      screen.getByRole('button', {
        name: 'alice.test からの依頼の知らせを閉じる',
      }),
    );
    expect(onDismiss).toHaveBeenLastCalledWith(a);
  });
});
