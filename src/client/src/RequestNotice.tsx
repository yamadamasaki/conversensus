/**
 * 届いた依頼の通知 (agent 段 4 R5, 計画 Q3 案 A)
 *
 * 画面右下の通知 (競合・上書き・fork と同じ所) に、自分宛てに送られた依頼を 1 つずつ出す。
 * 「開く」で依頼のある Sheet を開いて依頼 node へ寄せ、× で既読にする (既読は他の端末にも効く)。
 *
 * **生きた領域 (`role="status"`) にする** — 依頼は誰かが答えを待っている。上書きの報告のように
 * 控えめにはしない。
 */

import type { Did } from '@conversensus/shared';
import { X } from 'lucide-react';
import { useMessages } from './i18n/messages';
import type { RequestArrival } from './sync/requestArrival';
import { color, font, radius, shadow, space } from './theme';
import { Button, ICON_SIZE_SM } from './ui/Button';

/** 本文の抜粋の長さ (字) */
const EXCERPT_LENGTH = 60;

function excerpt(content: string): string {
  const line = content.replace(/\s+/g, ' ').trim();
  return line.length > EXCERPT_LENGTH
    ? `${line.slice(0, EXCERPT_LENGTH)}…`
    : line;
}

type Props = {
  arrivals: readonly RequestArrival[];
  /** 送った人の DID を表示名にする */
  labelOf: (did: Did) => string;
  onOpen: (arrival: RequestArrival) => void;
  onDismiss: (arrival: RequestArrival) => void;
};

export function RequestNotice({ arrivals, labelOf, onOpen, onDismiss }: Props) {
  const t = useMessages();
  if (arrivals.length === 0) return null;
  return (
    <section
      role="status"
      aria-label={t.request.notice.region}
      style={{
        width: 380,
        maxWidth: 'calc(100vw - 32px)',
        maxHeight: '40vh',
        overflowY: 'auto',
        background: color.bg,
        border: `1px solid ${color.border}`,
        borderLeft: `4px solid ${color.primary}`,
        borderRadius: radius.md,
        boxShadow: shadow.dialog,
        padding: space[3],
        fontSize: font.body,
        lineHeight: 1.6,
      }}
    >
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {arrivals.map((a) => {
          const from = labelOf(a.from);
          return (
            <li
              key={`${a.nodeId}-${a.sent}`}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: space[2],
                padding: `${space[1]}px 0`,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{t.request.notice.arrived(from)}</strong>
                <div style={{ color: color.textMuted }}>
                  {excerpt(a.content)}
                </div>
              </div>
              <Button
                variant="primary"
                className="cs-btn--sm"
                onClick={() => onOpen(a)}
              >
                {t.request.notice.open}
              </Button>
              <button
                type="button"
                aria-label={t.request.notice.dismiss(from)}
                className="cs-btn cs-btn--icon cs-btn--sm"
                onClick={() => onDismiss(a)}
              >
                <X size={ICON_SIZE_SM} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
