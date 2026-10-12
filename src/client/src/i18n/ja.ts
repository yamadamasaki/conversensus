/**
 * 画面の文言: 日本語 (#50 i18n)。**これが正の辞書**で、他の言語はこれと同じ形を持つ (`messages.ts`)。
 *
 * - キーは意味の名前 (計画 Q4)。画面ごとに入れ子にする
 * - 値は文字列か、引数を取って文字列を返す関数 (数や名前を差し込む文)
 * - 概念の語 (File・Sheet・branch・commit・node など) は英語のまま書く (visual language §7)
 */
export const ja = {
  language: {
    label: '言語',
    names: { ja: '日本語', en: 'English' },
  },
};
