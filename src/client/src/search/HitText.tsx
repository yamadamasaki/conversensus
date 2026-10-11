/**
 * 検索の 1 件の見せ方 (要素の種類・欄・抜粋)。Sheet 内検索 (`SearchPanel`) と File をまたぐ検索
 * (`GlobalSearchDialog`, #248) で同じに見せる
 */

import { color, font } from '../theme';
import type { SearchHit } from './searchSheet';

/** 欄の名前。仕様の結果一覧が出す「要素の種類 (node/edge, label/content/property)」 */
const FIELD_LABEL = {
  label: 'label',
  content: '本文',
  property: 'property',
} as const;

const KIND_LABEL = {
  node: 'node',
  edge: 'edge',
} as const;

/** ヒットの同一性。**同じ要素が複数の欄で当たる**ので、id だけでは足りない */
export function hitKeyOf(hit: SearchHit): string {
  return `${hit.elementKind}:${hit.id}:${hit.field}:${hit.propertyName ?? ''}`;
}

/** 抜粋を 3 つに割る。ヒットした部分だけ色を変えるため */
function splitSnippet(hit: SearchHit): [string, string, string] {
  const end = hit.matchStart + hit.matchLength;
  return [
    hit.snippet.slice(0, hit.matchStart),
    hit.snippet.slice(hit.matchStart, end),
    hit.snippet.slice(end),
  ];
}

export function HitText({ hit }: { hit: SearchHit }) {
  const [before, match, after] = splitSnippet(hit);
  return (
    <>
      <span style={{ color: color.textMuted, fontSize: font.caption }}>
        {KIND_LABEL[hit.elementKind]} / {FIELD_LABEL[hit.field]}
        {/* property は名前と型も出す (仕様) */}
        {hit.propertyName !== undefined &&
          ` — ${hit.propertyName}: ${hit.propertyType}`}
      </span>
      <br />
      <span>
        {before}
        <mark style={{ background: color.warningBg }}>{match}</mark>
        {after}
      </span>
    </>
  );
}
