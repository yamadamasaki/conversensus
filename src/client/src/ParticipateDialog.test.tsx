import { afterEach, describe, expect, it } from 'bun:test';

const { render, screen, fireEvent, cleanup } = await import(
  '@testing-library/react'
);
const { ParticipateDialog } = await import('./ParticipateDialog');

afterEach(cleanup);

function setup(over: Partial<Parameters<typeof ParticipateDialog>[0]> = {}) {
  const submitted: string[] = [];
  let cancelled = 0;
  render(
    <ParticipateDialog
      onSubmit={(c) => submitted.push(c)}
      onCancel={() => {
        cancelled += 1;
      }}
      {...over}
    />,
  );
  return { submitted, cancelled: () => cancelled };
}

describe('参加コードの入力', () => {
  it('貼られた文字列をそのまま渡す (前後の空白は落とす)', () => {
    // 検証は呼び出し側が行う。ここで弾くと「なぜ駄目か」を出す責任が二重になる
    const { submitted } = setup();
    fireEvent.change(screen.getByLabelText('参加コード'), {
      target: { value: '  abc123  ' },
    });
    fireEvent.click(screen.getByText('参加する'));
    expect(submitted).toEqual(['abc123']);
  });

  it('空欄では何も起きない', () => {
    const { submitted } = setup();
    fireEvent.click(screen.getByText('参加する'));
    expect(submitted).toEqual([]);
  });

  it('busy の間は押せない', () => {
    const { submitted } = setup({ busy: true });
    fireEvent.change(screen.getByLabelText('参加コード'), {
      target: { value: 'abc' },
    });
    fireEvent.click(screen.getByText('参加する'));
    expect(submitted).toEqual([]);
  });
});

describe('結果の表示', () => {
  it('理由をそのまま出す — 貼り間違いと古いコードで対処が違う', () => {
    setup({ error: '参加コードとして読めない' });
    expect(screen.getByRole('alert').textContent).toBe(
      '参加コードとして読めない',
    );
  });
});

describe('閉じる', () => {
  it('キャンセルで閉じる', () => {
    const { cancelled } = setup();
    fireEvent.click(screen.getByText('キャンセル'));
    expect(cancelled()).toBe(1);
  });
});
