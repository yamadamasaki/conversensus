import { useMessages } from '../i18n/messages';
import { color, font, radius, shadow, space } from '../theme';
import { Button } from '../ui/Button';

/**
 * 新しい版の知らせ (#262)
 *
 * 重要度は「知らせ」(visual language §6.3): `--cs-border` の枠で、自分で閉じる。判断は要らない —
 * 古い版のままでも壊れない (知らない op は保存して読み飛ばす)。押すまで読み直さないのは、
 * 書きかけの文字を消さないため。
 *
 * 再読み込みしても手元の File は失わない (保存領域にあり、開いていた File と Sheet はアドレスで戻る)
 */

type Props = {
  /** 新しい版が配られているときだけ出す */
  available: boolean;
  onReload: () => void;
  onDismiss: () => void;
};

export function UpdateNotice({ available, onReload, onDismiss }: Props) {
  const t = useMessages();
  if (!available) return null;
  return (
    <section
      role="status"
      aria-label={t.update.label}
      style={{
        width: 380,
        maxWidth: 'calc(100vw - 32px)',
        background: color.bg,
        border: `1px solid ${color.border}`,
        borderRadius: radius.md,
        boxShadow: shadow.pop,
        padding: `${space[2]}px ${space[3]}px`,
        fontSize: font.body,
        lineHeight: 1.6,
      }}
    >
      <div>{t.update.text}</div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: space[2],
          marginTop: space[2],
        }}
      >
        <Button className="cs-btn--sm" onClick={onDismiss}>
          {t.update.later}
        </Button>
        <Button variant="primary" className="cs-btn--sm" onClick={onReload}>
          {t.update.reload}
        </Button>
      </div>
    </section>
  );
}
