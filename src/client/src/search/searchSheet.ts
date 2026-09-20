/**
 * シート内の文字列検索 (step2 Phase 7)
 *
 * 仕様: `deepse/requirements/spec/searching.md`
 *
 * ## 範囲は「いま見ているグラフ」である
 *
 * 仕様は検索の範囲を **「現在表示している sheet, あるいは branch」** と定める。
 * projection 全体でも op-log でもない — 時間を遡らないし、他のシートも串刺しにしない
 * (どちらも step 3)。**`Sheet` 1 つだけを引数に取る**のはその線引きそのものである。
 *
 * branch を開いているときも同じ関数で足りる。branch を開くと `activeFile.sheets` の
 * 当該シートが branch の projection に差し替わるので (`useBranchOperations`)、
 * 「いま表示しているシート」を渡せば trunk と branch の両方に効く。
 *
 * ## op-log を見ない
 *
 * 検索は**畳み込んだ後のグラフ**を見る。op-log を辿ると「消された要素」や「昔の値」が
 * 出てくるが、仕様が対象としているのは自分の projection であって履歴ではない。
 */

import {
  type GraphEdge,
  type GraphNode,
  type PropertyName,
  type PropertyType,
  propertyCategory,
  type Sheet,
} from '@conversensus/shared';

/** ヒットした場所。仕様の結果一覧が出す「要素の種類」の後半にあたる */
export type SearchField = 'label' | 'content' | 'property';

/** 検索がヒットした 1 件 */
export type SearchHit = {
  elementKind: 'node' | 'edge';
  /** `NodeId` か `EdgeId`。**ハイライトのためにここが要る** (結果 → グラフ) */
  id: string;
  field: SearchField;
  /** `field` が `property` のときだけ入る */
  propertyName?: PropertyName;
  /** `field` が `property` のときだけ入る。**値から推論したもの** */
  propertyType?: PropertyType;
  /** 表示用の抜粋。前後が切れていれば省略記号が付く */
  snippet: string;
  /** `snippet` の中でのヒット開始位置 (結果一覧で色を付けるため) */
  matchStart: number;
  /** ヒットの長さ */
  matchLength: number;
};

export type SearchOptions = {
  /** 既定は大小文字を無視する。仕様が挙げるトグルはこれ 1 つである */
  caseSensitive?: boolean;
};

/** 抜粋でヒットの前後に何文字添えるか。仕様「content の場合は, 前後のテキストも部分的に表示」 */
export const SNIPPET_CONTEXT = 30;

/** 前後が切れていることを示す記号 */
const ELLIPSIS = '…';

/** 配列の要素を並べるときの区切り */
const ARRAY_SEPARATOR = ', ';

/**
 * プロパティの値を検索できる文字列にする。仕様「property の値 (文字列に変換して)」。
 *
 * 配列は要素を並べる — `JSON.stringify` に通すと `["a","b"]` となり、**引用符と角括弧が
 * 検索語に混ざる**。人が打つのは `a` であって `"a"` ではない。
 *
 * 構造体だけは `JSON.stringify` に落とす。**実際には検索に乗らない** — step 2 で構造体を
 * 値に持つのは `app.conversensus.image` だけで、それは system なので検索から除かれる。
 * それでも落とし先を決めておくのは、extension が構造体を持ち込んだときに黙って
 * 「検索に出てこない」になるより、読める形で出る方がましだからである。
 */
function toSearchText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (Array.isArray(value))
    return value.map(toSearchText).join(ARRAY_SEPARATOR);
  return JSON.stringify(value);
}

/**
 * ヒットの位置を返す。見つからなければ負。
 *
 * **大小文字を無視するとき、位置は元の文字列の上での位置である。**`toLowerCase` は
 * ほとんどの文字で長さを変えないのでこれで合うが、一部の文字 (トルコ語の `İ` など) は
 * 長さが変わり、位置が後ろへずれる。仕様が求めるのは部分一致の検索であって字形の
 * 正規化ではないので、ここは許容する (→ step 3)。
 */
function indexOfMatch(
  text: string,
  query: string,
  caseSensitive: boolean,
): number {
  if (caseSensitive) return text.indexOf(query);
  return text.toLowerCase().indexOf(query.toLowerCase());
}

/** ヒットの周りを切り出す。長い content をそのまま結果一覧に流さないための窓である */
function snippetOf(
  text: string,
  start: number,
  length: number,
): Pick<SearchHit, 'snippet' | 'matchStart' | 'matchLength'> {
  const from = Math.max(0, start - SNIPPET_CONTEXT);
  const to = Math.min(text.length, start + length + SNIPPET_CONTEXT);
  const prefix = from > 0 ? ELLIPSIS : '';
  const suffix = to < text.length ? ELLIPSIS : '';
  return {
    snippet: prefix + text.slice(from, to) + suffix,
    // 省略記号を足した分だけ後ろへずれる
    matchStart: prefix.length + (start - from),
    matchLength: length,
  };
}

/** 1 つの要素から拾えるだけ拾う。同じ要素が複数の欄でヒットすれば複数件になる */
function collectFrom(
  element: GraphNode | GraphEdge,
  elementKind: SearchHit['elementKind'],
  query: string,
  caseSensitive: boolean,
  hits: SearchHit[],
): void {
  const push = (
    field: SearchField,
    text: string,
    extra: Pick<SearchHit, 'propertyName' | 'propertyType'> = {},
  ): void => {
    if (text === '') return;
    const at = indexOfMatch(text, query, caseSensitive);
    if (at < 0) return;
    hits.push({
      elementKind,
      id: element.id,
      field,
      ...extra,
      ...snippetOf(text, at, query.length),
    });
  };

  // **label は種別名である** (Phase 5 P0 で本文と語を分けた)。template が当たって
  // いないシートでは undefined のままなので、その場合は欄ごと無い
  if (element.label !== undefined) push('label', element.label);

  // content を持つのは node だけである (edge に本文は無い)
  if ('content' in element) push('content', element.content);

  for (const [name, value] of Object.entries(element.properties ?? {})) {
    // **system のプロパティは検索に出さない。**仕様の property editor は system を
    // 「見えない, 追加/変更/削除できない」と定めている。画面に出ないものが検索だけで
    // 出てくると、開けない結果になる
    if (propertyCategory(name) === 'system') continue;
    push('property', toSearchText(value), {
      propertyName: name,
      // **型は宣言から来る** — 実装コードか template のような拡張が指定するもので、
      // 値から推論してはならない (利用者判断 2026-09-20)。step2 に宣言の仕組みは
      // 無く、編集できるプロパティはすべて custom なので文字列である。
      // `2026-09-20` という文字列に「日付」と出すのは、宣言されていない型の推測
      propertyType: 'string',
    });
  }
}

/**
 * シート内を検索する。
 *
 * 空の検索語では**何も返さない** — 空文字列はあらゆる文字列に含まれるので、素直に
 * 当てると全要素がヒットする。それは検索の結果ではなく一覧である。
 *
 * 結果の順序は **node → edge、各要素の中では label → content → property** で安定する。
 * 並びが端末や実行のたびに変わると、同じ検索で結果一覧の見え方が変わってしまう。
 */
export function searchSheet(
  sheet: Sheet,
  query: string,
  options: SearchOptions = {},
): SearchHit[] {
  if (query === '') return [];
  const caseSensitive = options.caseSensitive ?? false;
  const hits: SearchHit[] = [];
  for (const node of sheet.nodes)
    collectFrom(node, 'node', query, caseSensitive, hits);
  for (const edge of sheet.edges)
    collectFrom(edge, 'edge', query, caseSensitive, hits);
  return hits;
}
