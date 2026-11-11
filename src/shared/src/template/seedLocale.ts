/**
 * 作り込みの種 (template graph の種) の、言語ごとの名前 (#330 案 B、#356 で改めた)
 *
 * 作り込みの種は誰の言語でもないので、template graph の名前 (label・本文) は複製する人の言語にする
 * (`localizeSeed`)。#356 からは、それに加えて**種が持つすべての言語の名前・説明**を template graph に入れる
 * (`multilingualSeed`、種類の node・edge の `label:<言語>`・`description:<言語>`)。見る人の言語で表示するのは
 * 画面の側である (`kindLocale.ts`)。#330 案 B の「表示のたびに言語で引き直さない — 同じ File は同じ姿である」は
 * #356 で改めた。言語の違う参加者が読めない名前を見ないため。
 *
 * **id は変えない。**種類の id (`claim` など) は template graph を複製した後の参照に使われない (複製した node の
 * id が種類になる) が、種の表の綴りの照合 (`TemplateSchema`) と並べ方 (`KindPlacement`) は id で引く。
 *
 * 種の表は日本語で書いてある (`toulmin.ts`)。**それ以外の言語**の訳は種ごとに持つ (`TemplateSeed.translations`)。
 * 無い言語・無い要素は表のまま
 */

import type { KindLocale } from './kindLocale';
import type { KindPlacement } from './seed';
import type { Template } from './types';

/** 種の表 (`toulmin.ts`・module の種) を書いた言語 */
export const SEED_TABLE_LOCALE: KindLocale = 'ja';

/** 種を訳す先の言語。client の `Locale` と同じ綴り (shared は client を知らないので文字列で受ける) */
export type SeedLocale = string;

/** 1 つの言語への訳 (表の言語以外)。無い要素は表のまま */
export type SeedTranslation = {
  name?: string;
  nodeKinds: Readonly<Record<string, { label: string; description?: string }>>;
  edgeKinds: Readonly<Record<string, { label: string }>>;
};

/**
 * 種 1 つ: template の表と、並べ方 (#256) と、表の言語以外の訳 (#330)。core の種 (`CORE_SEEDS`) と、
 * module が出す種 (計画 node-actions-request-module.md B2) が同じ形をとる
 */
export type TemplateSeed = {
  template: Template;
  /** 種類の並べ方。無ければ格子に並べる (`templateGraphOf`) */
  placement?: KindPlacement;
  translations?: Readonly<Record<SeedLocale, SeedTranslation>>;
};

/** 種をその言語の名前にする。訳の無い言語・要素は表のまま */
export function localizeSeed(seed: TemplateSeed, locale: SeedLocale): Template {
  const base = seed.template;
  const tr = seed.translations?.[locale];
  if (!tr) return base;
  return {
    ...base,
    ...(tr.name !== undefined && { name: tr.name }),
    nodeKinds: base.nodeKinds.map((kind) => {
      const t = tr.nodeKinds[kind.id];
      return t
        ? {
            ...kind,
            label: t.label,
            ...(t.description !== undefined && { description: t.description }),
          }
        : kind;
    }),
    edgeKinds: base.edgeKinds.map((kind) => {
      const t = tr.edgeKinds[kind.id];
      return t ? { ...kind, label: t.label } : kind;
    }),
  };
}

/**
 * 種を、複製する人の言語の名前にし、種が持つすべての言語の名前・説明を付ける (#356)。
 * `templateGraphOf` がこれを種類の node・edge の property に書く。空の名前 (label の無い edge の種類) の言語は持たない
 */
export function multilingualSeed(
  seed: TemplateSeed,
  locale: SeedLocale,
): Template {
  const base = seed.template;
  const languages = Object.entries(seed.translations ?? {});
  /** 表の言語と各言語の訳を、空でないものだけ集める */
  const collect = (
    table: string | undefined,
    pick: (tr: SeedTranslation) => string | undefined,
  ) => {
    const entries = [
      [SEED_TABLE_LOCALE, table] as const,
      ...languages.map(([lang, tr]) => [lang, pick(tr)] as const),
    ].filter((e): e is readonly [string, string] => !!e[1]);
    return entries.length === 0 ? undefined : Object.fromEntries(entries);
  };
  const localized = localizeSeed(seed, locale);
  return {
    ...localized,
    nodeKinds: localized.nodeKinds.map((kind, i) => {
      const table = base.nodeKinds[i] ?? kind;
      const labels = collect(table.label, (tr) => tr.nodeKinds[kind.id]?.label);
      const descriptions = collect(
        table.description,
        (tr) => tr.nodeKinds[kind.id]?.description,
      );
      return {
        ...kind,
        ...(labels && { labels }),
        ...(descriptions && { descriptions }),
      };
    }),
    edgeKinds: localized.edgeKinds.map((kind, i) => {
      const table = base.edgeKinds[i] ?? kind;
      const labels = collect(table.label, (tr) => tr.edgeKinds[kind.id]?.label);
      return { ...kind, ...(labels && { labels }) };
    }),
  };
}
