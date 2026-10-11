/**
 * 見た目の体系 (deepse/architecture/step3/visual-language.md) を部品から使う口。
 *
 * **色は値ではなく役割で参照する。**値は `index.css` の CSS 変数にあり、ここはその名前を
 * 持つだけ — ダークモードを足すときは `index.css` の値だけを変えればよい。
 * inline style からも使えるよう `var(--cs-…)` の文字列にしてある。
 */

/** §1 色の役割 */
export const color = {
  // §1.1 地と線と文字
  bg: 'var(--cs-bg)',
  bgSubtle: 'var(--cs-bg-subtle)',
  bgHover: 'var(--cs-bg-hover)',
  bgActive: 'var(--cs-bg-active)',
  border: 'var(--cs-border)',
  borderSubtle: 'var(--cs-border-subtle)',
  borderStrong: 'var(--cs-border-strong)',
  text: 'var(--cs-text)',
  textMuted: 'var(--cs-text-muted)',
  textDisabled: 'var(--cs-text-disabled)',
  textOnPrimary: 'var(--cs-text-on-primary)',
  // §1.2 アクセント
  primary: 'var(--cs-primary)',
  primaryHover: 'var(--cs-primary-hover)',
  selection: 'var(--cs-selection)',
  selectionBg: 'var(--cs-selection-bg)',
  focus: 'var(--cs-focus)',
  // §1.3 差分と競合 — グラフの言語。ほかの用途に使わない
  diffAdd: 'var(--cs-diff-add)',
  diffAddBg: 'var(--cs-diff-add-bg)',
  diffAddText: 'var(--cs-diff-add-text)',
  diffUpdate: 'var(--cs-diff-update)',
  diffUpdateBg: 'var(--cs-diff-update-bg)',
  diffUpdateText: 'var(--cs-diff-update-text)',
  diffDelete: 'var(--cs-diff-delete)',
  conflict: 'var(--cs-conflict)',
  conflictBg: 'var(--cs-conflict-bg)',
  conflictText: 'var(--cs-conflict-text)',
  // §1.4 状態の知らせ
  danger: 'var(--cs-danger)',
  dangerBg: 'var(--cs-danger-bg)',
  dangerText: 'var(--cs-danger-text)',
  warning: 'var(--cs-warning)',
  warningBg: 'var(--cs-warning-bg)',
  warningText: 'var(--cs-warning-text)',
  successText: 'var(--cs-success-text)',
} as const;

/** §2 文字の段 (px)。11 より小さくしない */
export const font = {
  /** chip・バッジ・edge の label・注記・時刻 */
  caption: 11,
  /** サイドバー・ヘッダ・ダイアログ・入力欄・node の本文 */
  body: 13,
  /** ダイアログの題・pane の見出し */
  heading: 15,
  /** 空の状態の見出し */
  title: 18,
} as const;

export const fontWeight = {
  normal: 400,
  strong: 600,
} as const;

/** monospace は機械の値 (id・hash・DID・参加コード) にだけ使う (§2) */
export const monospace = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/** §3 余白は 4px 刻み */
export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  6: 24,
} as const;

/** §3 角丸は 2 種類: 小部品 (ボタン・入力欄・chip・タブ) と面 (node・ダイアログ・ポップオーバー・通知) */
export const radius = {
  sm: 4,
  md: 8,
} as const;

/** §3 影は 2 段と、ダイアログの背景の幕 */
export const shadow = {
  pop: 'var(--cs-shadow-pop)',
  dialog: 'var(--cs-shadow-dialog)',
} as const;

export const overlay = 'var(--cs-overlay)';

/** 線の書き方を 1 か所に — `border: line(color.border)` */
export function line(
  c: string,
  width = 1,
  style: 'solid' | 'dashed' = 'solid',
): string {
  return `${width}px ${style} ${c}`;
}
