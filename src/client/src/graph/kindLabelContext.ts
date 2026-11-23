/**
 * 種類の名前を見る人の言語で表示する口 (#356、計画 kind-i18n-356.md)
 *
 * 当てた template と見る人の言語は `GraphEditor` が知っている。node・edge の部品へは、この context で
 * 「label を表示する形にする関数」だけを渡す (部品に template を配らない)。**表示だけに使う** — 編集・保存は
 * 生の label を扱う。無ければ label のまま (template の無い所・単体のテスト)
 */

import type { PropertyName } from '@conversensus/shared';
import { createContext, useContext } from 'react';

export type KindLabelOf = (
  element: 'node' | 'edge',
  properties: Readonly<Record<PropertyName, unknown>> | undefined,
  label: string,
) => string;

const KindLabelContext = createContext<KindLabelOf>(
  (_element, _properties, label) => label,
);

export const KindLabelProvider = KindLabelContext.Provider;

export function useKindLabel(): KindLabelOf {
  return useContext(KindLabelContext);
}

/**
 * 種類の content の placeholder (template-update K13、#411): 本文が空の node に薄く出す、その種類の template
 * graph の本文 (見る人の言語)。markdown の種類だけ。無ければ undefined
 */
export type KindPlaceholderOf = (
  properties: Readonly<Record<PropertyName, unknown>> | undefined,
) => string | undefined;

const KindPlaceholderContext = createContext<KindPlaceholderOf>(
  () => undefined,
);

export const KindPlaceholderProvider = KindPlaceholderContext.Provider;

export function useKindPlaceholder(): KindPlaceholderOf {
  return useContext(KindPlaceholderContext);
}
