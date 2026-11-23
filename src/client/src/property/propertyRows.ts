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
  type EffectiveEntry,
  edgeKindsOf,
  isKindProperty,
  isKindTranslationProperty,
  isPropertySchemaProperty,
  type KindPropertyLabel,
  kindPropertyOf,
  type PropertyName,
  type PropertyType,
  parsePropertyType,
  propertyCategory,
  propertySchemaIn,
  type Template,
  type TemplatePropertyLabel,
} from '@conversensus/shared';

/** なぜ編集できないか。**理由を持つ**のは、画面が「なぜ灰色なのか」を言えるようにするため */
export type ReadOnlyReason =
  /** template が付けた種別。作成時に決まり変更できない (仕様 OnMutation) */
  | 'templateKind'
  /** template が値を固定している (editable: false、template-update K8)。値は常に template の既定値 */
  | 'templateFixed'
  /** アプリ (system、`app.conversensus.*`) が付けた値。読み取り専用の表示を選んだときだけ出る (#357) */
  | 'system'
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
  /**
   * 種別の property の、人が読める名前 (#384)。あれば画面は名前と値を id でなくこちらで出す。
   * 知らない template・種類のものには無い (id のまま出す)
   */
  kindLabel?: KindPropertyLabel;
  /**
   * template graph の行だけが持つ、その property の宣言 (template-update K9・Q4)。あれば画面は型の入力欄と
   * editable のチェックを出す。値 (`value`) は適用先の既定値で、宣言だけの property (既定値なし) では undefined
   */
  schema?: RowSchema;
  /**
   * template が配った property (`${templateId}.<名前>`) の、人が読める名前 (template-update K7)。あれば画面は
   * prefix を外した名前と template の名前で出す
   */
  templateLabel?: TemplatePropertyLabel;
  /**
   * 値の出どころが template のとき (template-update K8・K12)。`default` = 要素に値が無く既定値を補った (既定値も
   * 無ければ値は undefined)、`fixed` = editable: false で template の値
   */
  origin?: 'default' | 'fixed';
  /** 宣言した型に合わないとき (`mismatch`)・必須の値が無いとき (`missing`)。合えば無い */
  check?: 'missing' | 'mismatch';
  /** 宣言した型の文字列 (読めるときだけ)。画面は型に合わせた入力欄を出す */
  declaredType?: string;
};

/** template graph の行の宣言 (`propertySchema.ts` の 1 項目を画面向けにしたもの) */
export type RowSchema = {
  /** 型の文字列。宣言が無ければ空 */
  type: string;
  editable: boolean;
  /** 型の文字列が読めないときの理由 (`parsePropertyType`)。読めれば無い */
  typeError?: string;
};

/**
 * 読み取り専用の表示 (#357) を選んだときだけ出すプロパティか: system と template の種別。
 *
 * **ふだんは system を出さない** (仕様の表: 「見えない, 追加/変更/削除できない」)。検索が system を除くのと
 * 同じ規則である (`searchSheet.ts`)。#357 で、透明性のために利用者が選べば読み取り専用で出せるようにした。
 * 種別 (値は種類の node の id) も、編集できず読んでも意味の取りにくい値なので、同じ表示の側に置く。
 * 検索は今までどおり (選んでも system は探さない)
 */
function readOnlyByRule(name: string): boolean {
  return propertyCategory(name) === 'system' || isKindProperty(name);
}

/**
 * system の値の型。system は**アプリのコードが書く**ので、値の形がそのままコードの宣言である
 * (custom と違い、値から読むのが推測にならない)
 */
function systemTypeOf(value: unknown): PropertyType {
  if (Array.isArray(value)) return 'array';
  if (value !== null && typeof value === 'object') return 'object';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
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
  /** 読み取り専用の property (system と種別) も出すか (#357)。既定は出さない */
  showReadOnly = false,
  /** 種別の property の、人が読める名前 (#384、`kindPropertyLabels`) */
  kindLabels: Readonly<Record<string, KindPropertyLabel>> = {},
  /**
   * template graph の要素か (template-update K9・Q4)。そうなら宣言 (`app.conversensus.propertySchema.*`) を
   * 行にせず、宣言する property の行に `schema` として添える。宣言だけで値の無い property も行にする
   */
  templateGraph = false,
  /** template が配った property の、人が読める名前 (template-update K7、`templatePropertyLabels`) */
  templateLabels: Readonly<Record<string, TemplatePropertyLabel>> = {},
  /** template が配った property の、読むときの姿 (template-update K8・K12、`effectiveTemplateProperties`) */
  effective: Readonly<Record<string, EffectiveEntry>> = {},
): PropertyRow[] {
  if (templateGraph) {
    return templateGraphRows(properties, showReadOnly, kindLabels);
  }
  if (Object.keys(effective).length > 0) {
    return withEffective(
      propertyRows(properties, showReadOnly, kindLabels, false, templateLabels),
      effective,
      templateLabels,
    );
  }
  const rows: PropertyRow[] = [];
  for (const [name, value] of Object.entries(properties ?? {})) {
    if (readOnlyByRule(name) && !showReadOnly) continue;
    if (propertyCategory(name) === 'system') {
      rows.push({ name, value, type: systemTypeOf(value), readOnly: 'system' });
      continue;
    }
    const readOnly = readOnlyReasonOf(name, value);
    const kindLabel = kindLabels[name];
    const templateLabel = templateLabels[name];
    // **型は宣言から来る。**step2 に宣言の仕組みは無く、編集できるプロパティは
    // すべて custom なので文字列である。**推測ではなく事実** — 値が文字列だからである
    rows.push({
      name,
      value,
      type: 'string',
      ...(readOnly ? { readOnly } : {}),
      ...(kindLabel ? { kindLabel } : {}),
      ...(templateLabel ? { templateLabel } : {}),
    });
  }
  return rows.sort(byName);
}

/**
 * template が配った property を、読むときの姿で行にする (template-update K8・K9・K12)。
 *
 * - 要素に値が無ければ既定値を補った行を足す (`origin: 'default'`)。既定値の無い宣言も行にする (値を入れられる
 *   ように)
 * - editable: false なら値は template の値で、編集できない (`templateFixed`)。要素が別の値を持っていても出さない
 * - 型を宣言していれば、合わない値・欠けた必須の値に印を付ける (値は書き換えない)
 */
function withEffective(
  rows: PropertyRow[],
  effective: Readonly<Record<string, EffectiveEntry>>,
  templateLabels: Readonly<Record<string, TemplatePropertyLabel>>,
): PropertyRow[] {
  const rowOf = new Map(rows.map((r) => [r.name, r]));
  for (const [name, entry] of Object.entries(effective)) {
    const marks = {
      ...(entry.check && entry.check !== 'ok' && { check: entry.check }),
      ...(entry.type !== undefined && { declaredType: entry.type }),
    };
    const fixed = entry.source === 'fixed';
    const existing = rowOf.get(name);
    if (existing && !fixed) {
      rowOf.set(name, { ...existing, ...marks });
      continue;
    }
    const templateLabel = templateLabels[name];
    rowOf.set(name, {
      name,
      value: entry.value,
      type: 'string',
      origin: fixed ? 'fixed' : 'default',
      ...(fixed && { readOnly: 'templateFixed' as const }),
      ...(templateLabel && { templateLabel }),
      ...marks,
    });
  }
  return [...rowOf.values()].sort(byName);
}

/**
 * template graph の行。宣言の property 自体は行にせず、宣言する property の行に添える (宣言は型の入力欄と
 * editable のチェックで直す)。**言語ごとの名前・説明 (`label:<言語>`、#356) は宣言の対象にしない** — 種類の
 * 名前であって、適用先の property ではないから
 */
function templateGraphRows(
  properties: Readonly<Record<string, unknown>> | undefined,
  showReadOnly: boolean,
  kindLabels: Readonly<Record<string, KindPropertyLabel>>,
): PropertyRow[] {
  const declared = propertySchemaIn(properties);
  const plain = Object.fromEntries(
    Object.entries(properties ?? {}).filter(
      ([name]) => !isPropertySchemaProperty(name),
    ),
  );
  const rows = propertyRows(plain, showReadOnly, kindLabels).map((row) =>
    declares(row.name)
      ? { ...row, schema: rowSchemaOf(declared[row.name]) }
      : row,
  );
  // 宣言だけで既定値の無い property も行にする (消すと宣言も消える)
  for (const name of Object.keys(declared)) {
    if (Object.hasOwn(plain, name) || !declares(name)) continue;
    rows.push({
      name,
      value: undefined,
      type: 'string',
      schema: rowSchemaOf(declared[name]),
    });
  }
  return rows.sort(byName);
}

/** 宣言を添えてよい property か: 利用者の (custom の) property で、言語ごとの名前・説明でないもの */
function declares(name: string): boolean {
  return (
    propertyCategory(name) === 'custom' && !isKindTranslationProperty(name)
  );
}

function rowSchemaOf(
  entry: { type?: string; editable: boolean } | undefined,
): RowSchema {
  const type = entry?.type ?? '';
  const parsed = type === '' ? undefined : parsePropertyType(type);
  return {
    type,
    editable: entry?.editable ?? true,
    ...(parsed && !parsed.ok && { typeError: parsed.error }),
  };
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

/**
 * property editor の対象 (`PropertyTarget`) から行を作る。App のボディの欄と右サイドバーの欄が同じ答えを使う
 */
export function propertyRowsOf(
  target: {
    properties: Readonly<Record<string, unknown>> | undefined;
    kindLabels?: Readonly<Record<string, KindPropertyLabel>>;
    templateGraph?: boolean;
    templateLabels?: Readonly<Record<string, TemplatePropertyLabel>>;
    effective?: Readonly<Record<string, EffectiveEntry>>;
  },
  showReadOnly: boolean,
): PropertyRow[] {
  return propertyRows(
    target.properties,
    showReadOnly,
    target.kindLabels,
    target.templateGraph,
    target.templateLabels,
    target.effective,
  );
}
