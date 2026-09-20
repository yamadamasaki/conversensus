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
 * ## 型は値から推論する
 *
 * **step 2 に「型が先に決まっている」状態は存在しない** (仕様「型は値の従属変数で
 * ある」)。`node.setProperty` / `edge.setProperty` は `{名前, 値}` しか運ばない。
 * 推論は `inferPropertyType` に委ね、検索の結果一覧 (Phase 7) と**同じ型を出す**。
 */

import {
  type EdgeKindRef,
  edgeKindsOf,
  inferPropertyType,
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
  'templateKind';

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
    rows.push({
      name,
      value,
      type: inferPropertyType(value),
      ...(isKindProperty(name) ? { readOnly: 'templateKind' as const } : {}),
    });
  }
  return rows.sort(byName);
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
