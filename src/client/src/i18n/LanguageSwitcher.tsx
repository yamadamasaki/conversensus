/**
 * 言語の切り替え (#50 i18n, 計画 Q1)。左サイドバーの下に置く。選んだ言語は端末に覚える (`setLocale`)
 *
 * 言語の名前はそれぞれの言語で書く (「English」「日本語」)。いまの言語が読めない人でも、自分の言語を探せる
 */

import { color, font } from '../theme';
import { getLocale, LOCALES, type Locale, setLocale } from './locale';
import { useMessages } from './messages';

export function LanguageSwitcher() {
  const t = useMessages();
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: font.caption,
        color: color.textMuted,
      }}
    >
      {t.language.label}
      <select
        value={getLocale()}
        onChange={(e) => setLocale(e.target.value as Locale)}
        style={{ fontSize: font.caption }}
      >
        {LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {t.language.names[locale]}
          </option>
        ))}
      </select>
    </label>
  );
}
