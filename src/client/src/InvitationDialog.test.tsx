import { afterEach, describe, expect, it } from 'bun:test';
import type { RosterRow } from './sync/rosterView';

const { render, screen, fireEvent, cleanup } = await import(
  '@testing-library/react'
);
const { InvitationDialog } = await import('./InvitationDialog');

afterEach(cleanup);

const A = 'did:plc:alice';
const B = 'did:plc:bob';

/** DID → ハンドル名。**画面に出るのは DID ではなくこちらである** */
const HANDLE: Record<string, string> = {
  [A]: 'alice.test',
  [B]: 'bob.test',
};
const labelOf = (did: string) => HANDLE[did] ?? did;

const rows: RosterRow[] = [
  { did: A, status: 'accepted', available: [] },
  { did: B, inviter: A, status: 'sent', available: ['revoke'] },
];

const noop = () => {};

function setup(over: Partial<Parameters<typeof InvitationDialog>[0]> = {}) {
  const actions: Array<[string, string]> = [];
  const generated: string[] = [];
  const histories: string[] = [];
  render(
    <InvitationDialog
      fileName="テスト"
      rows={rows}
      unreadable={[]}
      labelOf={labelOf}
      onOpenHistory={(did) => histories.push(did)}
      codeFor={() => 'CODE'}
      onGenerate={(h) => generated.push(h)}
      onAction={(a, did) => actions.push([a, did])}
      onClose={noop}
      {...over}
    />,
  );
  return { actions, generated, histories };
}

describe('一覧', () => {
  it('行ごとに参加者・依頼者・状態を出す', () => {
    setup();
    // **DID ではなくハンドル名が出る。**記録は DID、表示は名前である
    expect(screen.getByText('bob.test')).toBeTruthy();
    expect(screen.queryByText(B)).toBeNull();
    expect(screen.getByText('依頼中')).toBeTruthy();
    expect(screen.getByText('参加中')).toBeTruthy();
  });

  it('名前が引けなかった DID はそのまま出す', () => {
    // 空欄にすると「引けなかった」のか「そもそも無い」のかが区別できない
    setup({ labelOf: (did: string) => (did === A ? 'alice.test' : did) });
    expect(screen.getByText(B)).toBeTruthy();
  });

  it('離脱は理由を問わず「離脱中」に畳む', () => {
    // 仕様が「自分で辞めたか, 辞めさせられたかは問わない」と定めている。
    // 畳み込みは区別を持つが、画面はそれを使わない
    setup({
      rows: [
        { did: A, status: 'revoked', available: [] },
        { did: B, status: 'resigned', available: [] },
      ],
    });
    expect(screen.getAllByText('離脱中').length).toBe(2);
  });

  it('参加履歴は行ごとに開ける', () => {
    // 状態によらず全員分開ける。依頼を取り消された人の履歴こそ見たい
    const { histories } = setup();
    fireEvent.click(screen.getByLabelText('bob.test の参加履歴'));
    expect(histories).toEqual([B]);
  });

  it('作成者の依頼者欄は空にする (—)', () => {
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

  it('依頼中の行にだけコードのコピーを出す', () => {
    setup();
    expect(screen.getAllByText('コードをコピー').length).toBe(1);
  });

  it('コードが無ければコピーを出さない', () => {
    setup({ codeFor: () => null });
    expect(screen.queryByText('コードをコピー')).toBeNull();
  });
});

describe('読めなかった repo', () => {
  it('黙って隠さない — 「依頼したのに相手が出てこない」を説明できる唯一の記録である', () => {
    setup({ unreadable: [B] });
    expect(screen.getByRole('status').textContent).toContain('1 人分');
  });

  it('全部読めていれば出さない', () => {
    setup();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('新規の参加依頼', () => {
  it('ハンドル名を渡す (前後の空白は落とす)', () => {
    const { generated } = setup();
    fireEvent.change(screen.getByLabelText('ハンドル名'), {
      target: { value: '  bob.test  ' },
    });
    fireEvent.click(screen.getByText('参加依頼する'));
    expect(generated).toEqual(['bob.test']);
  });

  it('空欄では何も起きない', () => {
    const { generated } = setup();
    fireEvent.click(screen.getByText('参加依頼する'));
    expect(generated).toEqual([]);
  });

  it('busy の間は押せない', () => {
    const { generated, actions } = setup({ busy: true });
    fireEvent.click(screen.getByText('参加依頼する'));
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
