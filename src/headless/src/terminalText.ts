/**
 * 端末に出す文字列から制御文字を落とす (#391)
 *
 * CLI と常駐は、File の本文 (他の参加者が書いたもの) や claude の出力を端末に出す。制御文字 (ESC で始まる
 * 端末の命令など) をそのまま出すと、端末の表示を書き換えたり、題名や clipboard を操作されたりしうる。
 * 改行とタブだけを残し、C0・DEL・C1 の制御文字を落とす。ESC が落ちれば、続く命令の残りはただの文字として出る。
 */

/** 落とす制御文字: C0 (改行・タブを除く)・DEL・C1 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: 制御文字を落とすための正規表現
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/** 端末に出してよい形にする */
export function forTerminal(text: string): string {
  return text.replace(CONTROL, '');
}
