import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { SearchHit } from './search/searchSheet';

const { render, screen, fireEvent, cleanup } = await import(
  '@testing-library/react'
);
const { SearchPanel } = await import('./SearchPanel');

const onSearch = mock((_q: string, _c: boolean) => {});
const onReveal = mock((_hit: SearchHit) => {});
const onClose = mock(() => {});

afterEach(() => {
  cleanup();
  onSearch.mockClear();
  onReveal.mockClear();
  onClose.mockClear();
});

/**
 * ヒット 1 件。**既定では抜粋の全体がヒットしている**ことにする。
 *
 * 一部だけを mark で囲うと抜粋が複数のテキストノードに割れ、`getByText` が
 * 単一要素として拾えなくなる。ここで見たいのは分割ではなく行の同一性なので、
 * 割れ方を問うテストだけが `matchStart` / `matchLength` を明示する。
 */
function hit(over: Partial<SearchHit> = {}): SearchHit {
  const snippet = over.snippet ?? '主張';
  return {
    elementKind: 'node',
    id: 'n1',
    field: 'label',
    snippet,
    matchStart: 0,
    matchLength: snippet.length,
    ...over,
  };
}

function show(props: Partial<Parameters<typeof SearchPanel>[0]> = {}) {
  return render(
    <SearchPanel
      onSearch={onSearch}
      hits={[]}
      searched={false}
      onReveal={onReveal}
      onClose={onClose}
      {...props}
    />,
  );
}

const field = () => screen.getByLabelText('検索語');

describe('打った語で引く', () => {
  it('入力するたびにその時点の値で引く — Enter を待たない', () => {
    show();
    fireEvent.change(field(), { target: { value: 'あ' } });
    expect(onSearch).toHaveBeenCalledWith('あ', false);
  });

  it('日本語の変換中は引かない', () => {
    // 未確定の文字で検索が走ると、確定前に結果が入れ替わる。
    // **日本語が公用語のリポジトリで、これは日常的に踏む**
    show();
    fireEvent.compositionStart(field());
    fireEvent.change(field(), { target: { value: 'か' } });
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('変換が確定したら、確定後の値で引き直す', () => {
    // composing を下ろすだけで引き直しを忘れると、変換して確定した語では
    // 一度も検索されない
    show();
    fireEvent.compositionStart(field());
    fireEvent.change(field(), { target: { value: '蟹' } });
    fireEvent.compositionEnd(field());
    expect(onSearch).toHaveBeenCalledWith('蟹', false);
  });
});

describe('大小文字のトグル', () => {
  it('トグルを変えたらその場で引き直す', () => {
    // 押してから打ち直させると、トグルの意味が分からない
    show();
    fireEvent.change(field(), { target: { value: 'Abc' } });
    onSearch.mockClear();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onSearch).toHaveBeenCalledWith('Abc', true);
  });
});

describe('結果から要素への橋渡し', () => {
  it('押した行の SearchHit で onReveal を呼ぶ', () => {
    const target = hit({ snippet: '主張' });
    show({ hits: [target], searched: true });
    fireEvent.click(screen.getByText('主張'));
    expect(onReveal).toHaveBeenCalledWith(target);
  });

  it('同じ要素の欄違いが混ざらない', () => {
    // key が id だけだと片方が消えるか、押したときにもう片方が反応する
    const asLabel = hit({ field: 'label', snippet: 'ラベルの語' });
    const asContent = hit({ field: 'content', snippet: '本文の語' });
    show({ hits: [asLabel, asContent], searched: true });

    fireEvent.click(screen.getByText('ラベルの語'));
    expect(onReveal).toHaveBeenLastCalledWith(asLabel);
    fireEvent.click(screen.getByText('本文の語'));
    expect(onReveal).toHaveBeenLastCalledWith(asContent);
  });
});

describe('0 件と「まだ引いていない」を分ける', () => {
  it('検索前は結果の領域ごと出さない', () => {
    // 0 件と同じ見た目にすると、開いた瞬間に「見つかりません」と出る
    show({ searched: false });
    expect(screen.queryByText('見つかりませんでした')).toBeNull();
  });

  it('引いたうえでの 0 件はそう言う', () => {
    // 黙って空にすると、壊れているのか無いのかが分からない
    show({ searched: true, hits: [] });
    expect(screen.getByText('見つかりませんでした')).toBeTruthy();
  });
});

describe('結果の出し方', () => {
  it('property は名前と型も出す', () => {
    show({
      searched: true,
      hits: [
        hit({
          field: 'property',
          propertyName: '期限',
          propertyType: 'date',
          snippet: '2026-09-20',
        }),
      ],
    });
    expect(screen.getByText(/期限: date/)).toBeTruthy();
  });

  it('ヒットした部分だけを mark で囲い、前後は残す', () => {
    const { container } = show({
      searched: true,
      hits: [hit({ snippet: 'あたりがある', matchStart: 3, matchLength: 2 })],
    });
    const mark = container.querySelector('mark');
    // 中核が返す位置をそのまま信じる。ずれていれば searchSheet.test.ts が落ちる
    expect(mark?.textContent).toBe('があ');
    // **中身だけを見てはならない。**前の断片を捨てる変異は mark の中身を変えない
    // ので、ここを見ないと生き残る (実際に生き残った)
    expect(mark?.parentElement?.textContent).toBe('あたりがある');
  });

  it('辺のヒットは辺として出す', () => {
    show({
      searched: true,
      hits: [hit({ elementKind: 'edge', snippet: '根拠づけ' })],
    });
    expect(screen.getByText(/辺 \/ 種別/)).toBeTruthy();
  });
});

describe('閉じる', () => {
  it('閉じるボタンで onClose', () => {
    show();
    fireEvent.click(screen.getByLabelText('検索を閉じる'));
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape でも閉じる', () => {
    show();
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
