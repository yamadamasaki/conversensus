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
 * 種の表は日本語で書いてある (`toulmin.ts`)。ここには**それ以外の言語**だけを置き、無い言語・無い要素は表のまま
 */

import { REQUEST_TEMPLATE } from './request';
import { TOULMIN_TEMPLATE } from './toulmin';
import type { Template } from './types';

/** 種を訳す先の言語。client の `Locale` と同じ綴り (shared は client を知らないので文字列で受ける) */
export type SeedLocale = string;

type SeedTranslation = {
  name?: string;
  nodeKinds: Readonly<Record<string, { label: string; description?: string }>>;
  edgeKinds: Readonly<Record<string, { label: string }>>;
};

const TRANSLATIONS: Readonly<
  Record<string, Readonly<Record<SeedLocale, SeedTranslation>>>
> = {
  [REQUEST_TEMPLATE.id]: {
    en: {
      name: 'Request / Consultation',
      nodeKinds: {
        request: {
          label: 'Request',
          description:
            'Ask the addressee to do what the body says. Write the answer in a new node and draw an edge from the request to it',
        },
        consultation: {
          label: 'Consultation',
          description:
            'Ask the addressee for an opinion on the body. Write the answer in a new node and draw an edge from the consultation to it',
        },
      },
      edgeKinds: {},
    },
  },
  [TOULMIN_TEMPLATE.id]: {
    en: {
      nodeKinds: {
        claim: {
          label: 'Claim',
          description: 'The conclusion being argued for',
        },
        data: {
          label: 'Data',
          description: 'The facts on which the claim rests',
        },
        warrant: {
          label: 'Warrant',
          description: 'Why the data supports the claim',
        },
        rebuttal: {
          label: 'Rebuttal',
          description: 'When the claim or the warrant does not hold',
        },
        backing: {
          label: 'Backing',
          description: 'What supports the warrant itself',
        },
      },
      edgeKinds: {
        supports: { label: 'supports' },
        validates: { label: 'justifies' },
        strengthens: { label: 'backs' },
        undermines: { label: 'rebuts' },
        challenges: { label: 'challenges' },
      },
    },
  },
};

/** 種をその言語の名前にする。訳の無い言語・要素は表のまま */
export function localizeSeed(seed: Template, locale: SeedLocale): Template {
  const tr = TRANSLATIONS[seed.id]?.[locale];
  if (!tr) return seed;
  return {
    ...seed,
    ...(tr.name !== undefined && { name: tr.name }),
    nodeKinds: seed.nodeKinds.map((kind) => {
      const t = tr.nodeKinds[kind.id];
      return t
        ? {
            ...kind,
            label: t.label,
            ...(t.description !== undefined && { description: t.description }),
          }
        : kind;
    }),
    edgeKinds: seed.edgeKinds.map((kind) => {
      const t = tr.edgeKinds[kind.id];
      return t ? { ...kind, label: t.label } : kind;
    }),
  };
}
