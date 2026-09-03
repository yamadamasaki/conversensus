import { afterEach, describe, expect, it } from 'bun:test';
import type { RosterRow } from './sync/rosterView';

const { render, screen, fireEvent, cleanup } = await import(
  '@testing-library/react'
);
const { InvitationDialog } = await import('./InvitationDialog');

afterEach(cleanup);

const A = 'did:plc:alice';
const B = 'did:plc:bob';

const rows: RosterRow[] = [
  { did: A, status: 'accepted', available: [] },
  { did: B, inviter: A, status: 'sent', available: ['revoke'] },
];

const noop = () => {};

function setup(over: Partial<Parameters<typeof InvitationDialog>[0]> = {}) {
  const actions: Array<[string, string]> = [];
  const generated: string[] = [];
  render(
    <InvitationDialog
      fileName="テスト"
      rows={rows}
      unreadable={[]}
      codeFor={() => 'CODE'}
      onGenerate={(h) => generated.push(h)}
      onAction={(a, did) => actions.push([a, did])}
      onClose={noop}
      {...over}
    />,
  );
  return { actions, generated };
}

describe('一覧', () => {
  it('行ごとにアクタ・招待者・状態を出す', () => {
    setup();
    expect(screen.getByText(B)).toBeTruthy();
    expect(screen.getByText('招待済')).toBeTruthy();
    expect(screen.getByText('参加中')).toBeTruthy();
  });

  it('作成者の招待者欄は空にする (—)', () => {
    setup();
    expect(screen.getAllByText('—').length).toBe(1);
  });

  it('available に無い action はそもそも出さない', () => {
    // 押せるのに畳み込みで捨てられる状態を画面に作らない。
    // 判断は rosterView が持ち、ここは描くだけである
    setup();
    expect(screen.queryByText('承認')).toBeNull();
    expect(screen.getByText('取り消す')).toBeTruthy();
  });

  it('action を押すと種類と対象を返す', () => {
    const { actions } = setup();
    fireEvent.click(screen.getByText('取り消す'));
    expect(actions).toEqual([['revoke', B]]);
  });

  it('招待済の行にだけコードのコピーを出す', () => {
    setup();
    expect(screen.getAllByText('コードをコピー').length).toBe(1);
  });

  it('コードが無ければコピーを出さない', () => {
    setup({ codeFor: () => null });
    expect(screen.queryByText('コードをコピー')).toBeNull();
  });
});

describe('読めなかった repo', () => {
  it('黙って隠さない — 「招待したのに相手が出てこない」を説明できる唯一の記録である', () => {
    setup({ unreadable: [B] });
    expect(screen.getByRole('status').textContent).toContain('1 人分');
  });

  it('全部読めていれば出さない', () => {
    setup();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('新規招待', () => {
  it('ハンドル名を渡す (前後の空白は落とす)', () => {
    const { generated } = setup();
    fireEvent.change(screen.getByLabelText('ハンドル名'), {
      target: { value: '  bob.test  ' },
    });
    fireEvent.click(screen.getByText('招待する'));
    expect(generated).toEqual(['bob.test']);
  });

  it('空欄では何も起きない', () => {
    const { generated } = setup();
    fireEvent.click(screen.getByText('招待する'));
    expect(generated).toEqual([]);
  });

  it('busy の間は押せない', () => {
    const { generated, actions } = setup({ busy: true });
    fireEvent.click(screen.getByText('招待する'));
    fireEvent.click(screen.getByText('取り消す'));
    expect(generated).toEqual([]);
    expect(actions).toEqual([]);
  });
});

describe('エラー', () => {
  it('理由をそのまま出す', () => {
    setup({ error: 'そのハンドルは見つからない' });
    expect(screen.getByRole('alert').textContent).toBe(
      'そのハンドルは見つからない',
    );
  });
});
