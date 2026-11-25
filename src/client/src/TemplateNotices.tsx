/**
 * template の版の通知 (template-update D3、計画 K1・K5)
 *
 * 画面右下の通知 (競合・上書き・知らせと同じ所) に、前に出ている File の Sheet に当てた template graph の
 * 新しい版と削除を 1 つずつ出す。新しい版は「最新の版にする」でその場で pull できる (D2 と同じ書き込み)。
 * × で既読にする (既読は他の端末にも効き、新しい版は先端がさらに変わるまで出ない)。
 *
 * **生きた領域 (`role="status"`) にするが、急ぎではない。**template の版は誰かが答えを待っているものではない。
 */

import { TEMPLATE_VERSION } from '@conversensus/shared';
import { X } from 'lucide-react';
import { useMessages } from './i18n/messages';
import type { TemplateNotice } from './notices/templateNotices';
import { color, font, radius, shadow, space } from './theme';
import { Button, ICON_SIZE_SM } from './ui/Button';

/** 通知の欄の幅 (ほかの知らせの欄と同じ) */
const PANEL_WIDTH = 380;
/**
 * 出す知らせの数 (v1.5.0 の UI レビュー U3)。当てた template が多い File で template graph をまとめて書き換えると、
 * 右下に積み上がる。届いた知らせ (#393) と同じ数で切り、残りは「ほか N 件」にする。前に出ている File の分だけを
 * 出すので、File ごとには分けない。畳んだ分も、その Sheet の「…」から最新の版にできる
 */
export const SHOWN_TEMPLATE_NOTICES = 5;

type Props = {
  notices: readonly TemplateNotice[];
  /** Sheet の名前 (当てた先)。読めなければ id のまま */
  sheetNameOf: (notice: TemplateNotice) => string;
  onPull: (notice: TemplateNotice) => void;
  onDismiss: (notice: TemplateNotice) => void;
};

export function TemplateNotices({
  notices,
  sheetNameOf,
  onPull,
  onDismiss,
}: Props) {
  const t = useMessages();
  if (notices.length === 0) return null;
  const shown = notices.slice(0, SHOWN_TEMPLATE_NOTICES);
  const hidden = notices.length - shown.length;
  return (
    <section
      role="status"
      aria-label={t.notices.templateRegion}
      style={{
        width: PANEL_WIDTH,
        maxWidth: 'calc(100vw - 32px)',
        maxHeight: '40vh',
        overflowY: 'auto',
        background: color.bg,
        border: `1px solid ${color.border}`,
        borderLeft: `4px solid ${color.textMuted}`,
        borderRadius: radius.md,
        boxShadow: shadow.dialog,
        padding: space[3],
        fontSize: font.body,
        lineHeight: 1.6,
      }}
    >
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {shown.map((n) => {
          const sheet = sheetNameOf(n);
          const template = n.templateName ?? t.notices.unnamedTemplate;
          const newer = n.version === TEMPLATE_VERSION.NEWER;
          return (
            <li
              key={n.key}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: space[2],
                padding: `${space[1]}px 0`,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                {newer
                  ? t.notices.templateNewer(sheet, template)
                  : t.notices.templateDeleted(sheet, template)}
              </div>
              {newer && (
                <Button
                  variant="primary"
                  className="cs-btn--sm"
                  onClick={() => onPull(n)}
                >
                  {t.notices.templatePull}
                </Button>
              )}
              <button
                type="button"
                aria-label={t.notices.templateDismiss(sheet, template)}
                className="cs-btn cs-btn--icon cs-btn--sm"
                onClick={() => onDismiss(n)}
              >
                <X size={ICON_SIZE_SM} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      {hidden > 0 && (
        <p style={{ margin: 0, color: color.textMuted }}>
          {t.notices.more(hidden)}
        </p>
      )}
    </section>
  );
}
