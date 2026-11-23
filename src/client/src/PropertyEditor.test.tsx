import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { PropertyRow } from './property/propertyRows';

const { render, screen, fireEvent, cleanup } = await import(
  '@testing-library/react'
);
const { PropertyEditor } = await import('./PropertyEditor');
const {
  getShowReadOnlyProperties,
  SHOW_READ_ONLY_PROPERTIES_STORAGE_KEY,
  setShowReadOnlyProperties,
} = await import('./property/readOnlyToggle');

const onSet = mock((_name: string, _value: unknown) => {});
const onRemove = mock((_name: string) => {});
const onClose = mock(() => {});

afterEach(() => {
  cleanup();
  setShowReadOnlyProperties(false);
  onSet.mockClear();
  onRemove.mockClear();
  onClose.mockClear();
});

function row(over: Partial<PropertyRow> = {}): PropertyRow {
  // **型は宣言から来るので文字列である** (値から推論しない、利用者判断 2026-09-20)
  return { name: '期限', value: '2026-09-20', type: 'string', ...over };
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
          // **型は宣言から来るので文字列である** (値から推論しない)。
          // 構造体かどうかは型ではなく**値の形**で判断している (Q1)
          type: 'string',
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

describe('値は文字列のまま返す', () => {
  it('数値に見えても文字列で返る', () => {
    // **型を指定するのは実装コードか拡張であって、入力された値ではない**
    // (利用者判断 2026-09-20)。入力から推論して寄せると、`3` と打っただけで
    // 数値になり、文字列の `"3"` を入れる手段が無くなる
    show({ rows: [row({ name: '優先度', value: '3', type: 'string' })] });
    const field = screen.getByLabelText('優先度 の値');
    fireEvent.change(field, { target: { value: '4' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSet).toHaveBeenCalledWith('優先度', '4');
  });

  it('真偽値に見えても文字列で返る', () => {
    show({ rows: [row({ name: '確定', value: 'false', type: 'string' })] });
    const field = screen.getByLabelText('確定 の値');
    fireEvent.change(field, { target: { value: 'true' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSet).toHaveBeenCalledWith('確定', 'true');
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
    fireEvent.change(screen.getByLabelText('追加する property の名前'), {
      target: { value: '出典' },
    });
    fireEvent.change(screen.getByLabelText('追加する property の値'), {
      target: { value: '甲' },
    });
    fireEvent.click(screen.getByText('追加'));
    expect(onSet).toHaveBeenCalledWith('出典', '甲');
  });

  it('既にある名前は追加できない', () => {
    // 追加のつもりで既存の値を上書きするのを防ぐ
    show();
    fireEvent.change(screen.getByLabelText('追加する property の名前'), {
      target: { value: '期限' },
    });
    fireEvent.click(screen.getByText('追加'));
    expect(onSet).not.toHaveBeenCalled();
  });

  it('空の名前は追加できない', () => {
    show({ rows: [] });
    fireEvent.change(screen.getByLabelText('追加する property の名前'), {
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
    expect(screen.queryByLabelText('追加する property の名前')).toBeNull();
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
    expect(screen.getByText('property はありません')).toBeTruthy();
  });

  it('閉じるボタンで onClose', () => {
    show();
    fireEvent.click(screen.getByLabelText('property を閉じる'));
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

describe('種別の行は人が読める名前で出す (#384)', () => {
  it('名前は template の名前の種類、値は種類の名前。id は hover で見られる', () => {
    show({
      rows: [
        row({
          name: 'template.11111111.kind',
          value: '22222222-2222-4222-8222-222222222222',
          readOnly: 'templateKind',
          kindLabel: { template: 'Toulmin model', kind: '主張' },
        }),
      ],
    });
    const name = screen.getByText('Toulmin model の種類');
    expect(name.getAttribute('title')).toBe('template.11111111.kind');
    const value = screen.getByText('主張');
    expect(value.getAttribute('title')).toBe(
      '22222222-2222-4222-8222-222222222222',
    );
    expect(screen.queryByText('template.11111111.kind')).toBeNull();
  });

  it('人が読める名前が無ければ id のまま出す (知らない template)', () => {
    show({
      rows: [
        row({
          name: 'com.unknown.vendor.kind',
          value: 'x',
          readOnly: 'templateKind',
        }),
      ],
    });
    expect(screen.getByText('com.unknown.vendor.kind')).toBeTruthy();
  });
});

describe('読み取り専用も表示 (#357)', () => {
  it('既定は off で、押すと on になり端末に覚える。もう一度押すと off に戻り、覚えたものも消す', () => {
    show();
    const toggle = screen.getByLabelText(
      '読み取り専用も表示',
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    fireEvent.click(toggle);
    expect(getShowReadOnlyProperties()).toBe(true);
    expect(toggle.checked).toBe(true);
    expect(localStorage.getItem(SHOW_READ_ONLY_PROPERTIES_STORAGE_KEY)).toBe(
      'true',
    );

    fireEvent.click(toggle);
    expect(getShowReadOnlyProperties()).toBe(false);
    expect(
      localStorage.getItem(SHOW_READ_ONLY_PROPERTIES_STORAGE_KEY),
    ).toBeNull();
  });

  it('同じ画面の 2 つの欄 (merger) は、どちらで切り替えても揃う', () => {
    show({ label: 'a' });
    show({ label: 'b' });
    const [a, b] = screen.getAllByLabelText(
      '読み取り専用も表示',
    ) as HTMLInputElement[];
    if (!a || !b) throw new Error('欄が 2 つ無い');
    fireEvent.click(a);
    expect(b.checked).toBe(true);
  });

  it('system の行は入力欄にならず、アプリが付けた値だと言う', () => {
    show({
      rows: [
        row({
          name: 'app.conversensus.request.addressee',
          value: ['did:plc:a'],
          type: 'array',
          readOnly: 'system',
        }),
      ],
    });
    expect(
      screen.queryByLabelText('app.conversensus.request.addressee の値'),
    ).toBeNull();
    expect(screen.getByText('アプリが付けた値で、変更できません')).toBeTruthy();
  });
});

describe('template graph の行: 型と editable の宣言 (template-update K9・Q4)', () => {
  const SCHEMA_OF = (name: string) => `app.conversensus.propertySchema.${name}`;
  const onChange = mock((_changes: Readonly<Record<string, unknown>>) => {});
  afterEach(() => onChange.mockClear());

  const schemaRow = (over: Partial<PropertyRow> = {}) =>
    row({ schema: { type: 'date', editable: true }, ...over });

  it('型の入力欄と editable のチェックを出し、値の欄は既定値と呼ぶ', () => {
    show({ rows: [schemaRow()], onChange });
    expect((screen.getByLabelText('期限 の型') as HTMLInputElement).value).toBe(
      'date',
    );
    expect(screen.getByLabelText('期限 の既定値')).toBeTruthy();
    expect(
      (screen.getByLabelText('適用先で編集できる') as HTMLInputElement).checked,
    ).toBe(true);
  });

  it('型を書いて確定すると宣言を 1 つの変更で書く', () => {
    show({ rows: [schemaRow()], onChange });
    const input = screen.getByLabelText('期限 の型');
    fireEvent.change(input, { target: { value: 'date?' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith({
      [SCHEMA_OF('期限')]: { type: 'date?', editable: true },
    });
  });

  it('editable を外すと宣言に書き、型を空にして editable なら宣言ごと消す', () => {
    show({ rows: [schemaRow()], onChange });
    fireEvent.click(screen.getByLabelText('適用先で編集できる'));
    expect(onChange).toHaveBeenLastCalledWith({
      [SCHEMA_OF('期限')]: { type: 'date', editable: false },
    });
    const input = screen.getByLabelText('期限 の型');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith({
      [SCHEMA_OF('期限')]: undefined,
    });
  });

  it('行を消すと、値と宣言を 1 つの変更で消す', () => {
    show({ rows: [schemaRow()], onChange });
    fireEvent.click(screen.getByLabelText('期限 を削除'));
    expect(onChange).toHaveBeenCalledWith({
      期限: undefined,
      [SCHEMA_OF('期限')]: undefined,
    });
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('読めない型には理由を出す', () => {
    show({
      rows: [
        schemaRow({
          schema: { type: 'strin', editable: true, typeError: 'x' },
        }),
      ],
      onChange,
    });
    expect(screen.getByRole('alert').textContent).toContain('型を読めません');
  });

  it('onChange が無ければ宣言の欄を出さない (template graph でない画面と同じ)', () => {
    show({ rows: [schemaRow()] });
    expect(screen.queryByLabelText('期限 の型')).toBeNull();
    expect(screen.getByLabelText('期限 の値')).toBeTruthy();
  });
});

describe('template が配った property の名前 (template-update K7)', () => {
  it('prefix を外した名前と template の名前で出し、名前そのものは hover で見られる', () => {
    show({
      rows: [
        row({
          name: 'template.x.期限',
          templateLabel: { template: 'Toulmin', name: '期限' },
        }),
      ],
    });
    const heading = screen.getByTitle('template.x.期限');
    expect(heading.textContent).toBe('期限Toulmin');
    expect(screen.getByLabelText('期限 の値')).toBeTruthy();
  });
});

describe('読むときの姿 (template-update K8・K9・K12)', () => {
  it('既定値を補っただけの行は、欄を空にして既定値を薄く出し、消すボタンを出さない', () => {
    show({ rows: [row({ value: '2026-12-01', origin: 'default' })] });
    const input = screen.getByLabelText('期限 の値') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('2026-12-01');
    expect(screen.queryByLabelText('期限 を削除')).toBeNull();
  });

  it('number を宣言した property は、打った文字列を数にして書く', () => {
    show({ rows: [row({ value: '', declaredType: 'number' })] });
    const input = screen.getByLabelText('期限 の値');
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSet).toHaveBeenCalledWith('期限', 3);
  });

  it('宣言の無い property は、数のような文字列も文字列のまま書く', () => {
    show();
    const input = screen.getByLabelText('期限 の値');
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSet).toHaveBeenCalledWith('期限', '3');
  });

  it('列挙を宣言した property は選択肢から選ばせる', () => {
    show({ rows: [row({ value: '高', declaredType: "'高' | '低'" })] });
    const select = screen.getByLabelText('期限 の値') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(select.value).toBe('高');
    fireEvent.change(select, { target: { value: '低' } });
    expect(onSet).toHaveBeenCalledWith('期限', '低');
  });

  it('型に合わない値・欠けた必須の値に印を出す', () => {
    show({
      rows: [
        row({ value: 'three', declaredType: 'number', check: 'mismatch' }),
        row({
          name: '担当',
          value: undefined,
          origin: 'default',
          check: 'missing',
        }),
      ],
    });
    const marks = screen.getAllByRole('status').map((e) => e.textContent);
    expect(marks.some((m) => m?.includes('number'))).toBe(true);
    expect(marks.some((m) => m?.includes('値がありません'))).toBe(true);
  });

  it('template が値を決めている行は編集させず、理由を言う', () => {
    show({
      rows: [
        row({ value: 'alice', origin: 'fixed', readOnly: 'templateFixed' }),
      ],
    });
    expect(screen.queryByLabelText('期限 の値')).toBeNull();
    expect(
      screen.getByText('template が値を決めていて、変更できません'),
    ).toBeTruthy();
  });
});
