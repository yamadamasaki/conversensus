/**
 * property editor に並べる行を組み立てる (step2 Phase 4 Q1)
 *
 * 仕様: `deepse/requirements/spec/propertyEditor.md`
 *
 * ## 画面を持たない
 *
 * ここは**何を出すか・編集させるか**だけを決める。どう見せるかは Q2 の仕事である。
 * 分ける理由は、この判断が仕様の可視性の表そのものだからで、表と見た目を同じ場所に
 * 置くと「見た目を直したら system が見えるようになった」が起こりうる。
 *
 * ## 型は宣言から来る (値から推論しない)
 *
 * **型を指定するのは実装コードか template のような拡張であって、入力された値では
 * ない** (利用者判断 2026-09-20)。カスタムのプロパティは node のインスタンスごとに
 * 値が違いうるので、その場の値から型を決めても**その型を使う場面が無い**。
 *
 * step 2 は型の宣言の仕組みを持たないので、編集できるプロパティはすべて custom =
 * **文字列**である。一覧に「文字列」と出すのは推測ではなく事実で、検索の結果一覧
 * (Phase 7) も同じ規則に揃えてある。
 *
 * **型の出どころと編集可否は別の軸である** — 拡張が定義する属性には、型を持ちつつ
 * 値をユーザが上書きできるものもありうる。だから `type` と `readOnly` を別に持つ。
 */

import {
  type EdgeKindRef,
  edgeKindsOf,
  isKindProperty,
  kindPropertyOf,
  type PropertyName,
  type PropertyType,
  propertyCategory,
  type Template,
} from '@conversensus/shared';

/** なぜ編集できないか。**理由を持つ**のは、画面が「なぜ灰色なのか」を言えるようにするため */
export type ReadOnlyReason =
  /** template が付けた種別。作成時に決まり変更できない (仕様 OnMutation) */
  | 'templateKind'
  /**
   * 配列・構造体。**編集の仕方が決まっていない** — 文字列欄で直させると、区切りの
   * 解釈規則をここで発明することになり、`['甲','乙']` と `['甲, 乙']` を分けられない。
   * 仕様は構造体の型の扱いを「別に決める必要がある」として先送りしている。
   * **値ごと差し替える口 (削除して追加し直す) は残る**ので、行き止まりにはならない。
   */
  | 'structuredValue';

/** property editor の 1 行 */
export type PropertyRow = {
  name: PropertyName;
  value: unknown;
  /** 値から推論した型。保存されていない (step 2) */
  type: PropertyType;
  /**
   * 編集できない理由。無ければ編集できる。
   *
   * **真偽値ではなく理由にする。**「編集できない」だけだと画面が説明できず、
   * 押せそうで押せない要素になる (Phase 5 が label で踏んだ形)。
   */
  readOnly?: ReadOnlyReason;
};

/**
 * 行にしないプロパティか。
 *
 * **system は出さない** (仕様の表: 「見えない, 追加/変更/削除できない」)。
 * 検索が system を除くのと同じ規則で、**画面に出ないものだけが検索にも出ない**ことを
 * 揃えている (`searchSheet.ts`)。
 */
function hidden(name: string): boolean {
  return propertyCategory(name) === 'system';
}

/**
 * 名前順に並べる。
 *
 * **`Object.entries` の順に頼らない。**挿入順なので、他者の op が届いた順で行が
 * 入れ替わる。検索の結果一覧と違い、ここは**編集する表**である — 押そうとした行が
 * 動くのは、見え方の問題ではなく誤操作の問題になる。
 *
 * 比較は `localeCompare` — 日本語のプロパティ名 (`期限`, `優先度`) が普通に来る。
 */
function byName(a: PropertyRow, b: PropertyRow): number {
  return a.name.localeCompare(b.name, 'ja');
}

/**
 * その要素の properties から、editor に並べる行を作る。
 *
 * **template を引数に取らない。**読み取り専用の判定は `isKindProperty` (語尾 `.kind`)
 * で足りる — どの template のものかを問う必要が無いからである。Phase 5 が
 * `kind.ts` にこの述語を置き、「**『編集させてよいか』のように template を特定する
 * 必要が無い問い**に使う」と用途まで書いている。`EditableNode` と
 * `EditableLabelEdge` が同じ判断をしており、ここが 3 例目になる。
 */
export function propertyRows(
  properties: Readonly<Record<string, unknown>> | undefined,
): PropertyRow[] {
  const rows: PropertyRow[] = [];
  for (const [name, value] of Object.entries(properties ?? {})) {
    if (hidden(name)) continue;
    const readOnly = readOnlyReasonOf(name, value);
    // **型は宣言から来る。**step2 に宣言の仕組みは無く、編集できるプロパティは
    // すべて custom なので文字列である。**推測ではなく事実** — 値が文字列だからである
    rows.push({
      name,
      value,
      type: 'string',
      ...(readOnly ? { readOnly } : {}),
    });
  }
  return rows.sort(byName);
}

/**
 * 編集できない理由。無ければ編集できる。
 *
 * **権限が先、能力が後。**種別は「編集して**はいけない**」(仕様 OnMutation)、
 * 構造体は「編集の**仕方が無い**」である。両方に当たる値 (種別が配列になっている、
 * など op-log が壊れている場合) では、**禁止の方を出す** — 画面の説明として
 * 「変更できない種別です」の方が正しい。
 *
 * **構造体かどうかは値の形から見る。**型は宣言から来るので常に `'string'` であり、
 * 型を見ても配列を見分けられない。ここで問うているのは「宣言された型」ではなく
 * 「文字列欄で編集できる形か」なので、値そのものを見るのが正しい。
 */
function readOnlyReasonOf(
  name: string,
  value: unknown,
): ReadOnlyReason | undefined {
  if (isKindProperty(name)) return 'templateKind';
  // **配列もここに入る** — `typeof [] === 'object'` だからである。
  // 当初は `Array.isArray` の行を別に置いていたが、**変異試験で等価と分かった**ので
  // 外した (配列が真なら必ずこちらも真になる)。
  if (value !== null && typeof value === 'object') return 'structuredValue';
  return undefined;
}

/**
 * この edge に追加できるプロパティ名の候補 (仕様「プロパティの追加時に**名前を
 * 選択するメニュー**」)。
 *
 * **Phase 5 が宣言だけ置いた `EdgeKind.properties` の、最初の消費者である**
 * (設計 事実 D:「step2 では宣言だけである。これを食う property editor は Phase 4 が
 * 作る」)。宣言は型の中で眠ったままだった。
 *
 * **判定は template ごとに閉じる。**その edge が持つ種別プロパティ
 * (`kindPropertyOf`) を見て、**同じ template の** `edgeKinds` から引く。混ぜて引くと、
 * T1 の種類の宣言を T2 の edge に出す混線が起こる (`edgeKindCandidates` と同じ判断)。
 *
 * **既に値が入っている名前は候補から外す。**行として出ているものを「追加」の一覧に
 * 並べると、押したときに何も起きないか、既存の値を消すことになる。
 */
export function addablePropertyNames(
  templates: readonly Template[],
  properties: Readonly<Record<string, unknown>> | undefined,
): PropertyName[] {
  const held = new Set(Object.keys(properties ?? {}));
  const kind = currentEdgeKind(templates, properties);
  if (kind === undefined) return [];
  return kind.kind.properties.filter((name) => !held.has(name));
}

/**
 * その edge が持っている種類を、**種類の実体まで**解決する。
 *
 * 名前だけで見分ける `isKindProperty` とは別物である — あちらは「編集させてよいか」に
 * 使い、こちらは宣言を引くので実体が要る (`templateEdge.ts` の `currentEdgeKindId` と
 * 同じ使い分け)。
 *
 * **解決できなければ候補なし。**知らない template の種類で追加を塞がない
 * (`templatesOf` が知らない id を黙って落とすのと同じ判断)。
 */
function currentEdgeKind(
  templates: readonly Template[],
  properties: Readonly<Record<string, unknown>> | undefined,
): EdgeKindRef | undefined {
  if (!properties) return undefined;
  for (const t of templates) {
    const value = properties[kindPropertyOf(t.id)];
    if (typeof value !== 'string' || value === '') continue;
    const found = edgeKindsOf([t]).find((ref) => ref.kind.id === value);
    if (found) return found;
  }
  return undefined;
}
