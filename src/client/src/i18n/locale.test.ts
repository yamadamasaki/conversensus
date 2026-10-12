import { afterEach, describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  FALLBACK_LOCALE,
  getLocale,
  LOCALE_STORAGE_KEY,
  LOCALES,
  parseStoredLocale,
  pickLocale,
  setLocale,
  subscribeLocale,
} from './locale';

afterEach(() => {
  setLocale('ja');
  localStorage.removeItem(LOCALE_STORAGE_KEY);
});

describe('pickLocale', () => {
  test('好みの順に、辞書のある最初の言語を選ぶ。地域付きは言語の部分で比べる', () => {
    expect(pickLocale(['fr-FR', 'ja-JP', 'en-US'])).toBe('ja');
    expect(pickLocale(['EN-gb'])).toBe('en');
  });

  test('どれも無ければ en', () => {
    expect(pickLocale([])).toBe(FALLBACK_LOCALE);
    expect(pickLocale(['fr', 'de-DE'])).toBe(FALLBACK_LOCALE);
  });

  test('性質: どんな並びでも辞書のある言語を返し、辞書のある言語が並びにあればそれ以外は返さない', () => {
    const tag = fc.oneof(
      fc.constantFrom('ja', 'ja-JP', 'en', 'en-US', 'fr', 'zh-Hant-TW', ''),
      fc.string(),
    );
    fc.assert(
      fc.property(fc.array(tag), (tags) => {
        const picked = pickLocale(tags);
        expect(LOCALES).toContain(picked);
        const first = tags
          .map((t) => t.toLowerCase().split('-')[0])
          .find((l) => (LOCALES as readonly string[]).includes(l ?? ''));
        expect(picked as string).toBe(first ?? FALLBACK_LOCALE);
      }),
    );
  });
});

describe('parseStoredLocale', () => {
  test('辞書のある言語だけを読む', () => {
    expect(parseStoredLocale('en')).toBe('en');
    expect(parseStoredLocale('fr')).toBeNull();
    expect(parseStoredLocale(null)).toBeNull();
  });
});

describe('setLocale', () => {
  test('替えると端末に覚え、<html lang> を合わせ、購読者に知らせる', () => {
    let notified = 0;
    const stop = subscribeLocale(() => {
      notified += 1;
    });
    setLocale('en');
    stop();
    expect(getLocale()).toBe('en');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(notified).toBe(1);
  });

  test('同じ言語なら知らせない', () => {
    let notified = 0;
    const stop = subscribeLocale(() => {
      notified += 1;
    });
    setLocale('ja');
    stop();
    expect(notified).toBe(0);
  });
});
