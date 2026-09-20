import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { PropertyRow } from './property/propertyRows';

const { render, screen, fireEvent, cleanup } = await import(
  '@testing-library/react'
);
const { PropertyEditor } = await import('./PropertyEditor');

const onSet = mock((_name: string, _value: unknown) => {});
const onRemove = mock((_name: string) => {});
const onClose = mock(() => {});

afterEach(() => {
  cleanup();
  onSet.mockClear();
  onRemove.mockClear();
  onClose.mockClear();
});

function row(over: Partial<PropertyRow> = {}): PropertyRow {
  return { name: '期限', value: '2026-09-20', type: 'date', ...over };
}

function show(props: Partial<Parameters<typeof PropertyEditor>[0]> = {}) {
  return render(
    <PropertyEditor
      title="ノード"
      rows={[row()]}
      addable={[]}
      onSet={onSet}
      onRemove={onRemove}
      onClose={onClose}
      {...props}
    />,
  );
}

describe('編集できるかで要素そのものを変える', () => {
  it('編集できる行は入力欄になる', () => {
    show();
    expect(screen.getByLabelText('期限 の値')).toBeTruthy();
  });

  it('種別は入力欄にならず、理由が出る', () => {
    // 変更できない値を disabled の入力欄にすると、打てそうで打てない欄になる
    show({
      rows: [
        row({
          name: 'jp.co.metabolics.toulmin.kind',
          value: 'claim',
          type: 'string',
          readOnly: 'templateKind',
        }),
      ],
    });
    expect(
      screen.queryByLabelText('jp.co.metabolics.toulmin.kind の値'),
    ).toBeNull();
    expect(screen.getByText(/種別は作成時に決まり/)).toBeTruthy();
  });

  it('構造を持つ値も編集させないが、理由は種別と違う', () => {
    // 理由ごとに文言が違うことを固定する。同じにするなら理由を持つ意味が無い
    show({
      rows: [
        row({
          name: '出典',
          value: ['甲', '乙'],
          type: 'array',
          readOnly: 'structuredValue',
        }),
      ],
    });
    expect(screen.queryByLabelText('出典 の値')).toBeNull();
    expect(screen.getByText(/構造を持つ値は/)).toBeTruthy();
    // 値は読める形で出す
    expect(screen.getByText('甲, 乙')).toBeTruthy();
  });
});

describe('値の確定', () => {
  it('Enter で確定する', () => {
    show();
    const field = screen.getByLabelText('期限 の値');
    fireEvent.change(field, { target: { value: '2026-12-31' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSet).toHaveBeenCalledWith('期限', '2026-12-31');
  });

  it('blur でも確定する', () => {
    // どちらか片方だと、打ってから別の行へ移った編集が消える
    show();
    const field = screen.getByLabelText('期限 の値');
    fireEvent.change(field, { target: { value: '2026-12-31' } });
    fireEvent.blur(field);
    expect(onSet).toHaveBeenCalledWith('期限', '2026-12-31');
  });

  it('変わっていなければ何も起きない', () => {
    // 変わらないものを積むと、偽の LWW 上書きが T8 の報告に出る (Phase 5 の判断)
    show();
    const field = screen.getByLabelText('期限 の値');
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.blur(field);
    expect(onSet).not.toHaveBeenCalled();
  });

  it('Escape で元に戻り、確定しない', () => {
    show();
    const field = screen.getByLabelText('期限 の値') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'めちゃくちゃ' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(field.value).toBe('2026-09-20');
    expect(onSet).not.toHaveBeenCalled();
  });

  it('IME 変換中の Enter は確定しない', () => {
    // 日本語の確定 Enter で値まで確定すると、変換しただけで op が飛ぶ。
    // **日本語が公用語のリポジトリで、これは日常的に踏む**
    show({ rows: [row({ name: '備考', value: 'あ', type: 'string' })] });
    const field = screen.getByLabelText('備考 の値');
    fireEvent.compositionStart(field);
    fireEvent.change(field, { target: { value: 'かんじ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSet).not.toHaveBeenCalled();
  });
});

describe('型を保って返す', () => {
  it('数値は数値のまま返る', () => {
    // 文字列で返すと型が number から string へ黙って変わり、型を出す意味が失われる
    show({ rows: [row({ name: '優先度', value: 3, type: 'number' })] });
    const field = screen.getByLabelText('優先度 の値');
    fireEvent.change(field, { target: { value: '4' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSet).toHaveBeenCalledWith('優先度', 4);
  });

  it('寄せられなければ文字列のまま返る', () => {
    // `3` → `やや高い` は型が変わったのであって誤りではない (検証は step3)
    show({ rows: [row({ name: '優先度', value: 3, type: 'number' })] });
    const field = screen.getByLabelText('優先度 の値');
    fireEvent.change(field, { target: { value: 'やや高い' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSet).toHaveBeenCalledWith('優先度', 'やや高い');
  });
});

describe('削除', () => {
  it('ゴミ箱で onRemove を呼ぶ', () => {
    show();
    fireEvent.click(screen.getByLabelText('期限 を削除'));
    expect(onRemove).toHaveBeenCalledWith('期限');
  });
});

describe('追加の口', () => {
  it('名前と値を入れて追加できる', () => {
    show({ rows: [] });
    fireEvent.change(screen.getByLabelText('追加するプロパティの名前'), {
      target: { value: '出典' },
    });
    fireEvent.change(screen.getByLabelText('追加するプロパティの値'), {
      target: { value: '甲' },
    });
    fireEvent.click(screen.getByText('追加'));
    expect(onSet).toHaveBeenCalledWith('出典', '甲');
  });

  it('既にある名前は追加できない', () => {
    // 追加のつもりで既存の値を上書きするのを防ぐ
    show();
    fireEvent.change(screen.getByLabelText('追加するプロパティの名前'), {
      target: { value: '期限' },
    });
    fireEvent.click(screen.getByText('追加'));
    expect(onSet).not.toHaveBeenCalled();
  });

  it('空の名前は追加できない', () => {
    show({ rows: [] });
    fireEvent.change(screen.getByLabelText('追加するプロパティの名前'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByText('追加'));
    expect(onSet).not.toHaveBeenCalled();
  });

  it('候補は datalist で出す — 宣言に無い名前も足せる', () => {
    // select にすると選択肢に閉じてしまうが、custom は自由である
    const { container } = show({ rows: [], addable: ['出典', '確度'] });
    const options = container.querySelectorAll('datalist option');
    expect([...options].map((o) => o.getAttribute('value'))).toEqual([
      '出典',
      '確度',
    ]);
  });
});

describe('読み取り専用のとき (Phase 2 S6)', () => {
  it('行が文字になり、追加の口も消える', () => {
    show({ readOnly: true });
    expect(screen.queryByLabelText('期限 の値')).toBeNull();
    expect(screen.queryByLabelText('追加するプロパティの名前')).toBeNull();
  });

  it('見るのは止めない', () => {
    // 「読むための操作は残す」という S6 の判断に揃える
    show({ readOnly: true });
    expect(screen.getByText('2026-09-20')).toBeTruthy();
  });
});

describe('その他', () => {
  it('プロパティが無ければそう言う', () => {
    show({ rows: [] });
    expect(screen.getByText('プロパティはありません')).toBeTruthy();
  });

  it('閉じるボタンで onClose', () => {
    show();
    fireEvent.click(screen.getByLabelText('プロパティを閉じる'));
    expect(onClose).toHaveBeenCalled();
  });

  it('他者の編集が届いたら開いたままの欄も追従する', () => {
    const { rerender } = show();
    const field = screen.getByLabelText('期限 の値') as HTMLInputElement;
    expect(field.value).toBe('2026-09-20');
    rerender(
      <PropertyEditor
        title="ノード"
        rows={[row({ value: '2027-01-01' })]}
        addable={[]}
        onSet={onSet}
        onRemove={onRemove}
        onClose={onClose}
      />,
    );
    expect((screen.getByLabelText('期限 の値') as HTMLInputElement).value).toBe(
      '2027-01-01',
    );
  });
});
