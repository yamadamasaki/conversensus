/**
 * module の知らせ (届いた依頼など、agent 段 4 R5・計画 Q3 案 A、node-actions-request-module.md B1)
 *
 * 画面右下の通知 (競合・上書き・fork と同じ所) に、module が受信から見つけた知らせを 1 つずつ出す。
 * module ごとに 1 つの欄にし、欄の名前と見出しは module が持つ (`NoticeSource`)。
 * 「開く」で知らせの node のある Sheet を開いてその node へ寄せ、× で既読にする (既読は他の端末にも効く)。
 *
 * **生きた領域 (`role="status"`) にする** — 依頼は誰かが答えを待っている。上書きの報告のように
 * 控えめにはしない。
 */

import type { Did } from '@conversensus/shared';
import { X } from 'lucide-react';
import { useLocale, useMessages } from './i18n/messages';
import { type ArrivedNotice, noticeKeyOf } from './nodeActions/registry';
import { useNodeActionRegistry } from './nodeActions/registryContext';
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
  notices: readonly ArrivedNotice[];
  /** 送り手の DID を表示名にする */
  labelOf: (did: Did) => string;
  onOpen: (notice: ArrivedNotice) => void;
  onDismiss: (notice: ArrivedNotice) => void;
};

/** 知らせの欄の幅 */
const PANEL_WIDTH = 380;

export function ArrivedNotices({ notices, labelOf, onOpen, onDismiss }: Props) {
  const t = useMessages();
  const locale = useLocale();
  const registry = useNodeActionRegistry();
  // module ごとに 1 つの欄 (届いた順)
  const byModule = new Map<string, ArrivedNotice[]>();
  for (const n of notices) {
    byModule.set(n.moduleId, [...(byModule.get(n.moduleId) ?? []), n]);
  }
  return (
    <>
      {[...byModule].map(([moduleId, ofModule]) => {
        const source = registry.noticeSource(moduleId);
        // 登録の外の知らせは出さない (module を外した後に残った既読の候補など)
        if (!source) return null;
        return (
          <section
            key={moduleId}
            role="status"
            aria-label={source.region[locale]}
            style={{
              width: PANEL_WIDTH,
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
              {ofModule.map((n) => {
                const from = labelOf(n.from);
                return (
                  <li
                    key={noticeKeyOf(n)}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: space[2],
                      padding: `${space[1]}px 0`,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong>{source.heading(from)[locale]}</strong>
                      <div style={{ color: color.textMuted }}>
                        {excerpt(n.content)}
                      </div>
                    </div>
                    <Button
                      variant="primary"
                      className="cs-btn--sm"
                      onClick={() => onOpen(n)}
                    >
                      {t.notices.open}
                    </Button>
                    <button
                      type="button"
                      aria-label={t.notices.dismiss(from)}
                      className="cs-btn cs-btn--icon cs-btn--sm"
                      onClick={() => onDismiss(n)}
                    >
                      <X size={ICON_SIZE_SM} aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}
