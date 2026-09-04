import { afterEach, describe, expect, it } from 'bun:test';
import type { ParticipationRound } from './sync/participationHistoryView';

const { render, screen, cleanup, fireEvent } = await import(
  '@testing-library/react'
);
const { ParticipationHistoryDialog } = await import(
  './ParticipationHistoryDialog'
);

afterEach(cleanup);

const A = 'did:plc:alice';
const B = 'did:plc:bob';
const labelOf = (did: string) =>
  ({ [A]: 'alice.test', [B]: 'bob.test' })[did] ?? did;

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();

function setup(rounds: ParticipationRound[]) {
  const closed: true[] = [];
  render(
    <ParticipationHistoryDialog
      label="bob.test"
      rounds={rounds}
      labelOf={labelOf}
      onClose={() => closed.push(true)}
    />,
  );
  return { closed };
}

describe('参加履歴', () => {
  it('日付と実行者を出す', () => {
    setup([
      {
        invited: { at: at(2026, 8, 31), by: A },
        joined: { at: at(2026, 9, 1), by: B },
      },
    ]);
    expect(screen.getByText('2026/08/31')).toBeTruthy();
    expect(screen.getByText('2026/09/01')).toBeTruthy();
    expect(screen.getByText('(alice.test)')).toBeTruthy();
    expect(screen.getByText('(bob.test)')).toBeTruthy();
  });

  it('実行者も DID ではなくハンドル名で出す', () => {
    setup([{ invited: { at: at(2026, 8, 31), by: A } }]);
    expect(screen.queryByText(`(${A})`)).toBeNull();
  });

  it('作成者の参加日時は — にする', () => {
    // genesis の timestamp は batch のべき等のために 0 固定である
    setup([{ joined: { at: 0, by: A } }]);
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('4 つの列をいつも出す', () => {
    setup([{ invited: { at: at(2026, 8, 31), by: A } }]);
    for (const c of ['依頼', '依頼取り止め', '参加', '参加取り止め'])
      expect(screen.getByText(c)).toBeTruthy();
  });

  it('記録が無ければそう言う — 空の表を出さない', () => {
    setup([]);
    expect(screen.getByText('まだ記録がない。')).toBeTruthy();
    expect(screen.queryByText('依頼取り止め')).toBeNull();
  });

  it('閉じられる', () => {
    const { closed } = setup([]);
    fireEvent.click(screen.getByText('閉じる'));
    expect(closed).toEqual([true]);
  });
});
