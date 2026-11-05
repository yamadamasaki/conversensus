/**
 * 入門への道 (step4)。左サイドバーの下、言語の切り替えの上に置く
 *
 * - **いまの言語の入門を開く**。言語を切り替えると行き先も替わる (`useLocale` で描き直す)
 * - **新しいタブで開く**。同じタブで移ると編集中の画面を離れる。`noopener` で開いた先から
 *   この画面を触らせず、`noreferrer` でこの画面の URL (Deep Link に File の id が入る) を渡さない
 */

import { BookOpen } from 'lucide-react';
import type { Locale } from './i18n/locale';
import { useLocale, useMessages } from './i18n/messages';
import { color, font } from './theme';
import { ICON_SIZE_SM } from './ui/Button';

/** 入門の置き場所 (docs.conversensus.site, `docs/.vitepress/config.mts` の URL と揃える) */
export const GUIDE_URLS: Record<Locale, string> = {
  ja: 'https://docs.conversensus.site/intro/',
  en: 'https://docs.conversensus.site/en/intro/',
};

const NEW_TAB = '_blank';
const SAFE_REL = 'noopener noreferrer';

export function GuideLink() {
  const t = useMessages();
  const locale = useLocale();
  return (
    <a
      href={GUIDE_URLS[locale]}
      target={NEW_TAB}
      rel={SAFE_REL}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        color: color.primary,
        fontSize: font.caption,
        textDecoration: 'none',
        padding: '2px 0',
      }}
    >
      <BookOpen size={ICON_SIZE_SM} aria-hidden="true" />
      {t.sidebar.guide}
    </a>
  );
}
