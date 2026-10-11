import { color, font, radius } from './theme';

/**
 * LocalOnlyBanner: 未ログインの間に、この端末にだけある編集を知らせる (FPR 前 L-3)
 *
 * 未ログインの編集は誰にも届かない。描いた側の画面には出ているので、届いていないことに
 * 気づけない (FPR の確認 §1)。ログインすれば訊いてから送られる (L-1) ので、知らせるのは
 * 「ログインしていない」ことと件数で足りる。押すとログインを始める。
 *
 * 件数が 0 なら何も出さない (未ログインで使うこと自体は普通のことなので、責めない)。
 */

type Props = {
  /** この端末にだけある (未ログインの actor の) batch の数 */
  count: number;
  onLogin: () => void;
};

export const LOCAL_ONLY_BANNER_LABEL = '未ログインの編集';

export function LocalOnlyBanner({ count, onLogin }: Props) {
  if (count === 0) return null;
  return (
    <button
      type="button"
      aria-label={LOCAL_ONLY_BANNER_LABEL}
      onClick={onLogin}
      style={{
        width: '100%',
        textAlign: 'left',
        background: color.warningBg,
        border: `1px solid ${color.warning}`,
        borderRadius: radius.sm,
        color: color.warningText,
        cursor: 'pointer',
        fontSize: font.caption,
        lineHeight: 1.5,
        padding: '4px 6px',
        marginBottom: 4,
      }}
    >
      未ログイン: この端末にだけ {count} 件の編集があります。
      ログインすると送られます
    </button>
  );
}
