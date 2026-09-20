/**
 * シート内検索の画面 (step2 Phase 7 S2)
 *
 * 仕様: `deepse/requirements/spec/searching.md`「UI」
 *
 * ## 最小で作る
 *
 * 仕様は「ダイアログは移動可能」と書いているが、**このリポジトリに移動できる
 * ダイアログは 1 つも無い** — 既存の 9 つはすべて `inset: 0` の覆いに中央寄せである。
 * 移動を作ると覆いの構造から変えることになり、見せ方の作り込みに入る。UI/UX の
 * 見直しは step 3 へ繰延と決まっているので (利用者判断 2026-09-20)、ここは
 * **既存の構造に載せる**。移動は step 3 で他のダイアログとまとめて見直す。
 *
 * ## 覆いを敷かない
 *
 * ただし**中央寄せの覆いは使わない**。検索は「結果を見ながらグラフを触る」もので、
 * 覆いがあるとダブルクリックで寄せた先が自分で隠れる。`ConflictNotice` と同じく
 * 隅に浮かべ、閉じる操作を人に委ねる。
 */

import { useEffect, useRef, useState } from 'react';
import type { SearchHit } from './search/searchSheet';

/** 検索窓と結果一覧の重なり順。ダイアログ (1000) より下、通知 (900) より下 */
export const SEARCH_Z_INDEX = 800;

/** 結果一覧の幅。`DIALOG_WIDTH` (380) より広い — 抜粋を読ませるためである */
const RESULTS_WIDTH = 420;

/** 結果一覧の高さの上限。これを超えたらスクロールさせる */
const RESULTS_MAX_HEIGHT = '50vh';

/** 欄の名前。仕様の結果一覧が出す「要素の種類 (node/edge, label/content/property)」 */
const FIELD_LABEL = {
  label: '種別',
  content: '本文',
  property: 'プロパティ',
} as const;

const KIND_LABEL = {
  node: 'ノード',
  edge: '辺',
} as const;

/** ヒットの同一性。**同じ要素が複数の欄で当たる**ので、id だけでは足りない */
function keyOf(hit: SearchHit): string {
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

type Props = {
  /** 検索語が変わるたびに呼ばれる。**Enter を待たない** (後述) */
  onSearch: (query: string, caseSensitive: boolean) => void;
  hits: readonly SearchHit[];
  /** 検索語が空でないのに 0 件のとき、「無い」と言うために要る */
  searched: boolean;
  /** 1 件を選んでグラフで示す。仕様「ダブル・クリックにより, グラフ内で対象をハイライト」 */
  onReveal: (hit: SearchHit) => void;
  onClose: () => void;
};

export function SearchPanel({
  onSearch,
  hits,
  searched,
  onReveal,
  onClose,
}: Props) {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  // 日本語の入力中 (変換中) に検索を走らせない。走らせると未確定の文字で
  // 引くことになり、確定前に結果が入れ替わる
  const composingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // **Enter を待たずに引く。**仕様は検索窓の要素として enter を挙げているが、
  // 打つたびに結果が出る方が「どこがどうだめか」を掴みやすい。Enter でも引けるので
  // 仕様を狭めてはいない
  const run = (nextQuery: string, nextCaseSensitive: boolean): void => {
    if (composingRef.current) return;
    onSearch(nextQuery, nextCaseSensitive);
  };

  return (
    <section
      aria-label="検索"
      style={{
        position: 'absolute',
        top: 52,
        right: 12,
        width: RESULTS_WIDTH,
        maxWidth: 'calc(100vw - 24px)',
        background: '#fff',
        border: '1px solid #ccc',
        borderRadius: 8,
        boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
        zIndex: SEARCH_Z_INDEX,
        fontSize: 13,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: 12,
          borderBottom: '1px solid #eee',
        }}
      >
        <input
          ref={inputRef}
          type="text"
          aria-label="検索語"
          placeholder="このシートを検索"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            run(e.target.value, caseSensitive);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(e) => {
            composingRef.current = false;
            // 変換が確定した時点の値で引き直す
            run(e.currentTarget.value, caseSensitive);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'Enter' && !composingRef.current)
              run(query, caseSensitive);
          }}
          style={{
            flex: 1,
            padding: '6px 8px',
            fontSize: 13,
            borderRadius: 4,
            border: '1px solid #ccc',
          }}
        />
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            whiteSpace: 'nowrap',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => {
              setCaseSensitive(e.target.checked);
              // トグルを変えたらその場で引き直す。押してから打ち直させない
              run(query, e.target.checked);
            }}
          />
          Aa
        </label>
        <button
          type="button"
          onClick={onClose}
          aria-label="検索を閉じる"
          style={{
            padding: '2px 8px',
            cursor: 'pointer',
            background: 'none',
            border: '1px solid #ccc',
            borderRadius: 4,
          }}
        >
          ✕
        </button>
      </div>

      {searched && (
        <div style={{ maxHeight: RESULTS_MAX_HEIGHT, overflowY: 'auto' }}>
          {hits.length === 0 ? (
            <p style={{ margin: 0, padding: 12, color: '#777' }}>
              見つかりませんでした
            </p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {hits.map((hit) => {
                const [before, match, after] = splitSnippet(hit);
                return (
                  <li key={keyOf(hit)}>
                    {/* **ダブルクリックで示す** (仕様)。ただし 1 回のクリックでも
                        効くようにしてある — 押して何も起きない UI は、壊れて
                        見えるからである */}
                    <button
                      type="button"
                      onClick={() => onReveal(hit)}
                      onDoubleClick={() => onReveal(hit)}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 12px',
                        border: 'none',
                        borderBottom: '1px solid #f0f0f0',
                        background: 'none',
                        cursor: 'pointer',
                        fontSize: 13,
                        lineHeight: 1.6,
                      }}
                    >
                      <span style={{ color: '#777', fontSize: 11 }}>
                        {KIND_LABEL[hit.elementKind]} / {FIELD_LABEL[hit.field]}
                        {/* property は名前と型も出す (仕様) */}
                        {hit.propertyName !== undefined &&
                          ` — ${hit.propertyName}: ${hit.propertyType}`}
                      </span>
                      <br />
                      <span>
                        {before}
                        <mark style={{ background: '#ffe58f' }}>{match}</mark>
                        {after}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
