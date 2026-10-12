/**
 * 辞書を引く口 (#50 i18n)
 *
 * - `messages()`: いまの言語の辞書。React の外 (フックの非同期処理・純関数) から使う
 * - `useMessages()`: React から使う。言語が替わると描き直す
 *
 * 辞書の形は正の辞書 (`ja.ts`) から求める (`Messages`)。他の言語はこの型を満たさなければならないので、
 * 訳し忘れたキーや、引数の形が違う関数は typecheck で捕まる
 */

import { useSyncExternalStore } from 'react';
import { en } from './en';
import { ja } from './ja';
import { getLocale, type Locale, subscribeLocale } from './locale';

/** 文字列のリテラル型を `string` に広げる (訳は別の文字列なので) */
type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => string
    ? (...args: A) => string
    : { [K in keyof T]: Widen<T[K]> };

export type Messages = Widen<typeof ja>;

/** 言語ごとの辞書。言語を足すときはここにも 1 つ足す (`Record` が足し忘れを捕まえる) */
export const CATALOGS: Record<Locale, Messages> = { ja, en };

export function messages(): Messages {
  return CATALOGS[getLocale()];
}

export function useMessages(): Messages {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale);
  return CATALOGS[locale];
}
