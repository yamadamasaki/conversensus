import { useMessages } from './i18n/messages';
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

export function StorageAtRiskBanner({ count, signedIn }: Props) {
  const t = useMessages();
  if (count === 0) return null;
  return (
    <div
      role="note"
      aria-label={t.banners.storageAtRisk}
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
      {t.banners.storageAtRiskText(count)}
      {signedIn
        ? t.banners.storageAtRiskSignedIn
        : t.banners.storageAtRiskSignedOut}
    </div>
  );
}
