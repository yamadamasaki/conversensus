import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

const { render, screen, fireEvent, cleanup } = await import(
  '@testing-library/react'
);
const { ErrorBoundary } = await import('./ErrorBoundary');

/** 外から壊す・直すを切り替えられる子 (描画中に例外を投げる) */
let broken = true;
function Fragile() {
  if (broken) throw new Error('壊れた値');
  return <p>中身</p>;
}

let consoleError: ReturnType<typeof spyOn>;

beforeEach(() => {
  broken = true;
  // React と境界が例外をコンソールに出す。テストの出力を汚さないよう黙らせて、呼ばれたことは見る
  consoleError = spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  consoleError.mockRestore();
});

describe('ErrorBoundary (#290)', () => {
  it('子が描画中に例外を投げたら、その場所と理由を知らせる', () => {
    render(
      <ErrorBoundary label="グラフ">
        <Fragile />
      </ErrorBoundary>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('グラフを表示できませんでした');
    expect(alert.textContent).toContain('壊れた値');
  });

  it('壊れたのは境界の内側だけで、隣は描かれたまま', () => {
    render(
      <>
        <ErrorBoundary label="グラフ">
          <Fragile />
        </ErrorBoundary>
        <ErrorBoundary label="左サイドバー">
          <p>ファイル一覧</p>
        </ErrorBoundary>
      </>,
    );
    expect(screen.getByRole('alert').textContent).toContain('グラフ');
    expect(screen.getByText('ファイル一覧')).toBeTruthy();
  });

  it('「もう一度表示する」で描き直し、直っていれば中身に戻る', () => {
    render(
      <ErrorBoundary label="グラフ">
        <Fragile />
      </ErrorBoundary>,
    );
    broken = false;
    fireEvent.click(screen.getByRole('button', { name: 'もう一度表示する' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('中身')).toBeTruthy();
  });

  it('例外をコンソールに残す (場所の名前つき)', () => {
    render(
      <ErrorBoundary label="グラフ">
        <Fragile />
      </ErrorBoundary>,
    );
    const ours = consoleError.mock.calls.filter((args: unknown[]) =>
      String(args[0]).startsWith('[ErrorBoundary] グラフ'),
    );
    expect(ours.length).toBe(1);
  });
});
