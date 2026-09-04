import { afterEach, describe, expect, it } from 'bun:test';
import type { FileId } from '@conversensus/shared';
import type { InvitationPreview } from './hooks/useParticipation';

const { render, screen, cleanup, fireEvent } = await import(
  '@testing-library/react'
);
const { AcceptInvitationDialog } = await import('./AcceptInvitationDialog');

afterEach(cleanup);

const preview: InvitationPreview = {
  fileId: '11111111-1111-4111-8111-111111111111' as FileId,
  inviter: 'did:plc:alice',
  inviterLabel: 'alice.test',
  inviteeLabel: 'bob.test',
  fileName: 'test file',
};

function setup(over: Partial<InvitationPreview> = {}, props = {}) {
  const accepted: true[] = [];
  const closed: true[] = [];
  render(
    <AcceptInvitationDialog
      preview={{ ...preview, ...over }}
      onAccept={() => accepted.push(true)}
      onClose={() => closed.push(true)}
      {...props}
    />,
  );
  return { accepted, closed };
}

describe('承認の確認', () => {
  it('誰が・あなたを・どのファイルに, を名前で出す', () => {
    setup();
    const text = screen.getByRole('dialog').textContent ?? '';
    expect(text).toContain('alice.test');
    expect(text).toContain('bob.test');
    expect(text).toContain('test file');
  });

  it('DID も FileId も出さない', () => {
    // 出しても判断の役に立たない。名前が引けなかったときだけ id が出る
    setup();
    const text = screen.getByRole('dialog').textContent ?? '';
    expect(text).not.toContain('did:plc:alice');
    expect(text).not.toContain('11111111');
  });

  it('名前が引けなければ fileId が出る — 空欄にしない', () => {
    // 「読めなかった」のか「名前が無い」のかを空欄で潰さない
    setup({ fileName: '11111111-1111-4111-8111-111111111111' });
    expect(screen.getByRole('dialog').textContent).toContain('11111111');
  });

  it('参加すると承認を返す', () => {
    const { accepted } = setup();
    fireEvent.click(screen.getByText('参加する'));
    expect(accepted).toEqual([true]);
  });

  it('閉じても承認しない', () => {
    const { accepted, closed } = setup();
    fireEvent.click(screen.getByText('閉じる'));
    expect(accepted).toEqual([]);
    expect(closed).toEqual([true]);
  });

  it('busy の間は参加できない', () => {
    const { accepted } = setup({}, { busy: true });
    fireEvent.click(screen.getByText('参加する'));
    expect(accepted).toEqual([]);
  });

  it('理由をそのまま出す', () => {
    setup({}, { error: '参加依頼が見つからない。取り消された可能性がある' });
    expect(screen.getByRole('alert').textContent).toBe(
      '参加依頼が見つからない。取り消された可能性がある',
    );
  });
});
