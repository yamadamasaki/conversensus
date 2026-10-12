import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LanguageSwitcher } from './LanguageSwitcher';
import { getLocale, LOCALE_STORAGE_KEY, setLocale } from './locale';

afterEach(() => {
  cleanup();
  setLocale('ja');
  localStorage.removeItem(LOCALE_STORAGE_KEY);
});

describe('LanguageSwitcher', () => {
  test('選ぶと言語が替わり、自分の文言もその言語で描き直す', () => {
    render(<LanguageSwitcher />);
    const select = screen.getByLabelText('言語') as HTMLSelectElement;
    expect(select.value).toBe('ja');
    fireEvent.change(select, { target: { value: 'en' } });
    expect(getLocale()).toBe('en');
    expect(screen.getByLabelText('Language')).toBeTruthy();
  });

  test('言語の名前はそれぞれの言語で書く', () => {
    render(<LanguageSwitcher />);
    expect(screen.getByRole('option', { name: 'English' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '日本語' })).toBeTruthy();
  });
});
