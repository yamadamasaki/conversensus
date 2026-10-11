import { color, font } from './theme';
/**
 * 描画中の例外を、その部分だけの知らせに留める (#290)。
 *
 * React は描画中の例外を受け止める境界が無いと**木全体を外す** — 画面が真っ白になり、
 * 何が起きたかも分からない。描くものには他人が書いた値 (受信した op) が混ざるので、
 * 1 つの壊れた値で全部が消えるのは避けたい。グラフ・左右のサイドバーと、アプリ全体に置く。
 *
 * 境界は class でしか書けない (React 19 にも hook 版は無い)。
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

/** どこが描けなかったか (「グラフ」「左サイドバー」など) */
export type BoundaryLabel = string;

/** 境界を置く場所の名前 (知らせの文に出る) */
export const BOUNDARY_LABELS = {
  app: 'conversensus',
  graph: 'グラフ',
  leftSidebar: '左サイドバー',
  rightSidebar: '右サイドバー',
} as const satisfies Record<string, BoundaryLabel>;

const FAILED_SUFFIX = 'を表示できませんでした';
const RETRY_LABEL = 'もう一度表示する';
const RELOAD_LABEL = '再読み込み';

type Props = { label: BoundaryLabel; children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      `[ErrorBoundary] ${this.props.label}${FAILED_SUFFIX}`,
      error,
      info.componentStack,
    );
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" style={{ padding: 16, fontSize: font.body }}>
        <p style={{ margin: '0 0 8px' }}>
          {this.props.label}
          {FAILED_SUFFIX}
        </p>
        <p style={{ margin: '0 0 12px', color: color.textMuted }}>
          {error.message}
        </p>
        {/* 例外が一時的なもの (読み込みの途中など) なら描き直せば戻る */}
        <button type="button" onClick={() => this.setState({ error: null })}>
          {RETRY_LABEL}
        </button>{' '}
        <button type="button" onClick={() => location.reload()}>
          {RELOAD_LABEL}
        </button>
      </div>
    );
  }
}
