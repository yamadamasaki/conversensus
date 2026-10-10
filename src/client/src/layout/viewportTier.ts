/**
 * 画面の幅の 3 段と、段ごとのサイドバーの出し方 (visual language §9.2, #278)
 *
 * | 幅 | 左サイドバー | 右サイドバー | ヘッダ |
 * | --- | --- | --- | --- |
 * | 1024px 以上 | 並べる | 並べる | すべて出す |
 * | 768〜1023px (iPad の縦) | 並べる、既定で畳む | ボディに重ねる | すべて出す |
 * | 767px 以下 (iPhone) | 重ねる (外側を押すと閉じる) | 重ねる | 記号だけ、溢れたら Ellipsis |
 *
 * **開閉を覚えるのは広い段だけ**である。`localStorage` の開閉は広い画面での好みで、
 * 狭い段では毎回畳んだ状態から始める — 重ねて出すサイドバーが開いたまま起動すると、
 * ボディが隠れて何も見えない。幅は段をまたいで同じものを使う。
 */

import type { PanelSide } from './sidePanels';

export type ViewportTier = 'wide' | 'medium' | 'narrow';

export const WIDE_MIN_WIDTH = 1024;
export const MEDIUM_MIN_WIDTH = 768;

export function tierOf(width: number): ViewportTier {
  if (width >= WIDE_MIN_WIDTH) return 'wide';
  if (width >= MEDIUM_MIN_WIDTH) return 'medium';
  return 'narrow';
}

export type PanelPresentation = {
  /** `docked` はボディと並べる、`overlay` はボディに重ねる */
  mode: 'docked' | 'overlay';
  /** 開閉を `localStorage` に覚えるか (広い段だけ) */
  remembersCollapse: boolean;
  /** 外側を押すと閉じるか */
  dismissOnOutside: boolean;
};

export function panelPresentation(
  tier: ViewportTier,
  side: PanelSide,
): PanelPresentation {
  if (tier === 'wide') {
    return { mode: 'docked', remembersCollapse: true, dismissOnOutside: false };
  }
  if (tier === 'medium') {
    return {
      mode: side === 'left' ? 'docked' : 'overlay',
      remembersCollapse: false,
      dismissOnOutside: false,
    };
  }
  return {
    mode: 'overlay',
    remembersCollapse: false,
    // 左はグラフを選ぶための入れ物なので、選んだら・外を押したら退く。右は選んだ要素の
    // property を見ながらグラフを触るので、外を押しても閉じない
    dismissOnOutside: side === 'left',
  };
}

/** ヘッダを記号だけにするか */
export function compactHeader(tier: ViewportTier): boolean {
  return tier === 'narrow';
}
