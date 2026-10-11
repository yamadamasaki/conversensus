import { color, font, radius } from './theme';

/**
 * StorageAtRiskBanner: この端末だけの File が、ブラウザに消されうることを知らせる (#263)
 *
 * Safari は、しばらく使わない Web サイトの保存領域を消すことがある (ITP)。アカウントに保存した
 * File は PDS から戻るが、**この端末だけの File (#253) は戻らない**。`persist()` が断られた
 * 端末でだけ出す — 認められていれば消されないので、責める理由が無い。
 *
 * 重要度は「状態」(visual language §6.3): 閉じられない。保存するか、File を消せば消える。
 */

type Props = {
  /** この端末だけの File の数 */
  count: number;
  /** ログインしているか (していなければ、まずログインが要る) */
  signedIn: boolean;
};

export const STORAGE_AT_RISK_LABEL = '端末だけの File が消えるおそれ';

export function StorageAtRiskBanner({ count, signedIn }: Props) {
  if (count === 0) return null;
  return (
    <div
      role="note"
      aria-label={STORAGE_AT_RISK_LABEL}
      style={{
        background: color.warningBg,
        border: `1px solid ${color.warning}`,
        borderRadius: radius.sm,
        color: color.warningText,
        fontSize: font.caption,
        lineHeight: 1.5,
        padding: '4px 6px',
        marginBottom: 4,
      }}
    >
      このブラウザは、しばらく使わない間にこの端末だけの File ({count} 件)
      を消すことがあります。
      {signedIn
        ? 'File の詳細の「アカウントに保存する」で保存してください'
        : 'ログインしてアカウントに保存してください'}
    </div>
  );
}
