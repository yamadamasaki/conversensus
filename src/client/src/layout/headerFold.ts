/**
 * ヘッダの操作を、幅が足りないときに「…」のメニューへ畳む段 (利用者の指摘 2026-10-12)
 *
 * File・Sheet・branch の名前は任意の長さで、操作も増えてきたので、1 行に並べると重なる。2 行にすると
 * 名前の長さでヘッダの高さが変わり canvas が跳ねる、左右に送る (`<` `>`) と隠れた操作の在りかが
 * 分からない。そこで**名前は省略し (全体は tooltip)、操作は使う頻度の低いものから畳む**。
 *
 * 段は 0 から上がる。
 * - 0: 全部を出し、文字のボタンは文字も出す
 * - 1: 文字のボタンを記号だけにし、PNG を畳む (以前の「狭い画面」と同じ)
 * - 2 以降: `HEADER_FOLD_ORDER` の順に 1 つずつ畳む
 *
 * undo / redo・property・commit / merge は畳まない (いつも使う、あるいは状態を見せる)
 */

/** 畳む順 (先頭ほど先に畳む) */
export const HEADER_FOLD_ORDER = [
  'png',
  'map',
  'link',
  'group',
  'search',
] as const;
export type FoldableControl = (typeof HEADER_FOLD_ORDER)[number];

export const MAX_FOLD_LEVEL = HEADER_FOLD_ORDER.length;

/** 文字のボタンを記号だけにする段 */
export const ICONS_ONLY_LEVEL = 1;

/** その段で畳んでいる操作 */
export function foldedAt(level: number): ReadonlySet<FoldableControl> {
  return new Set(HEADER_FOLD_ORDER.slice(0, Math.max(0, level)));
}

/** その段で文字のボタンを記号だけにするか */
export function iconsOnlyAt(level: number): boolean {
  return level >= ICONS_ONLY_LEVEL;
}

/**
 * 次の段。溢れていれば 1 つ上げる (上限で止まる)。溢れていなければそのまま。
 * **下げるのは幅が変わったときだけ**で、そのときは下限からやり直す (`useFoldLevel`)。
 * 溢れなくなった時点で下げると、下げた段でまた溢れて上下を繰り返す
 */
export function nextFoldLevel(level: number, overflowing: boolean): number {
  return overflowing && level < MAX_FOLD_LEVEL ? level + 1 : level;
}
