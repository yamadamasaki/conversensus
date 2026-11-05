import { afterEach, describe, expect, test } from 'bun:test';
import { act, render, screen } from '@testing-library/react';
import { GUIDE_URLS, GuideLink } from './GuideLink';
import { LOCALE_STORAGE_KEY, LOCALES, setLocale } from './i18n/locale';

afterEach(() => {
  setLocale('ja');
  localStorage.removeItem(LOCALE_STORAGE_KEY);
});

describe('GuideLink', () => {
  test('いまの言語の入門を指し、言語を替えると行き先も替わる', () => {
    setLocale('ja');
    render(<GuideLink />);
    const ja = screen.getByRole('link', { name: '入門を読む' });
    expect(ja.getAttribute('href')).toBe(
      'https://docs.conversensus.site/intro/',
    );
    act(() => setLocale('en'));
    const en = screen.getByRole('link', { name: 'Read the guide' });
    expect(en.getAttribute('href')).toBe(
      'https://docs.conversensus.site/en/intro/',
    );
  });

  test('新しいタブで開き、開いた先にこの画面と URL を渡さない', () => {
    render(<GuideLink />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  test('辞書のあるどの言語にも入門の置き場所がある', () => {
    for (const locale of LOCALES) {
      expect(GUIDE_URLS[locale]).toStartWith('https://docs.conversensus.site/');
    }
  });
});
