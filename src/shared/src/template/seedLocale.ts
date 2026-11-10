/**
 * 作り込みの種 (template graph の種) の、言語ごとの名前 (#330 案 B)
 *
 * **種だけを多言語にする。**利用者が作った template graph は作った人の言語で持ち、訳したい人が訳す。作り込みの種は
 * 誰の言語でもないので、ここだけは利用者の言語で File に焼き込む (`templateGraphOf` に渡す前に通す)。焼き込んだ
 * 後はふつうの利用者のデータで、表示のたびに言語で引き直すことはしない — 参加者が別の言語でも、同じ File は
 * 同じ姿である。
 *
 * **id は変えない。**種類の id (`claim` など) は template graph を複製した後の参照に使われない (複製した node の
 * id が種類になる) が、種の表の綴りの照合 (`TemplateSchema`) と並べ方 (`KindPlacement`) は id で引く。
 *
 * 種の表は日本語で書いてある (`toulmin.ts`)。**それ以外の言語**の訳は種ごとに持つ (`TemplateSeed.translations`)。
 * 無い言語・無い要素は表のまま
 */

import type { KindPlacement } from './seed';
import type { Template } from './types';

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
