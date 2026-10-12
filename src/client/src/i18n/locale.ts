/**
 * 画面の言語 (#50 i18n, 計画 Q1)
 *
 * 初回はブラウザの言語に従い (辞書に無ければ en)、利用者が切り替えたらそれを端末に覚える。
 * 現在の言語はモジュールに置く — 文言は React の外 (フックの非同期処理・純関数) からも引くので
 * (計画 F1)。React は購読して描き直す (`useMessages`)。
 */

import { safeLocalStorage } from '../sync/safeStorage';

/** 辞書のある言語。足すときは辞書を書いてここに 1 つ足す (`messages.ts` の `CATALOGS` も) */
export const LOCALES = ['ja', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** ブラウザの言語が辞書に無いときの言語 */
export const FALLBACK_LOCALE: Locale = 'en';

/** 切り替えた言語を覚えておく所 (端末ごと) */
export const LOCALE_STORAGE_KEY = 'conversensus.locale';

function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * ブラウザの言語の並び (好みの順) から、辞書のある最初の言語を選ぶ。`ja-JP` のような地域付きは
 * 言語の部分 (`ja`) で比べる。どれも無ければ `FALLBACK_LOCALE`
 */
export function pickLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const language = tag.toLowerCase().split('-')[0] ?? '';
    if (isLocale(language)) return language;
  }
  return FALLBACK_LOCALE;
}

/** 覚えておいた言語を読む。無い・読めない値なら null */
export function parseStoredLocale(raw: string | null): Locale | null {
  return raw !== null && isLocale(raw) ? raw : null;
}

function browserLocales(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length
    ? navigator.languages
    : navigator.language
      ? [navigator.language]
      : [];
}

function initialLocale(): Locale {
  try {
    const stored = parseStoredLocale(
      safeLocalStorage()?.getItem(LOCALE_STORAGE_KEY) ?? null,
    );
    if (stored) return stored;
  } catch {
    // 読めなければブラウザに従う
  }
  return pickLocale(browserLocales());
}

let current: Locale = initialLocale();
const listeners = new Set<() => void>();

/** 読み上げとブラウザの翻訳の提案に、いまの言語を知らせる */
function reflectToDocument(locale: Locale): void {
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}
reflectToDocument(current);

export function getLocale(): Locale {
  return current;
}

/** 言語を替えて端末に覚える。購読している画面は描き直す */
export function setLocale(locale: Locale): void {
  if (locale === current) return;
  current = locale;
  try {
    safeLocalStorage()?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // 覚えられなくても切り替えは効く。再読み込みでブラウザの言語に戻るだけである
  }
  reflectToDocument(locale);
  for (const listener of listeners) listener();
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
