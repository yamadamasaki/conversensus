/**
 * プロパティのキー単位の変更 (ANA-208)
 *
 * `deepse/requirements/spec/merging.md`「op の粒度」に従い、properties の変更は
 * **キー 1 つ** を単位に表す。全体を置換していた頃は、A が `foo` を B が `bar` を
 * 編集しただけで競合になり、負けた側のキーが丸ごと消えていた。
 *
 * ここは「置換の意味論」と「キー単位の意味論」の変換点である。client の
 * `NODE_PROPERTIES_CHANGED` は from/to の**全体**を運ぶ契約のままなので、
 * op へ落とすとき (`toUnified`) とローカル reducer (`applyEvent`) の両方が
 * この `diffProperties` を通す。両者が同じ差分を使うことで、画面の状態と
 * op-log の projection がずれない (レビュー R4 で揃えた不変条件の維持)。
 */

import type { PropertyName } from './unified';

export type Properties = Record<string, unknown>;

/**
 * システムのプロパティ名の接頭辞 (ANA-99 / #137)
 *
 * 名前の判定規則は **「`.` を含むか否か」の一点**である
 * (`deepse/requirements/spec/propertyEditor.md`「名前」)。`.` を含まない名前は
 * すべて custom (グラフの編集者のもの) なので、システムが使う名前は逆順ドメインの
 * 接頭辞を持たなければならない。
 */
export const SYSTEM_PROPERTY_PREFIX = 'app.conversensus.';

/**
 * 旧名 → 新名。**step0〜step1 で `.` 無しの名前で書かれてしまったもの**だけを載せる。
 *
 * op-log は追記のみで書き換えられないので、旧名の op はログに残り続ける。
 * ここを通して読む側で新名へ寄せる (issue #137 の方針)。
 *
 * `imageBlobCid` / `imageBlobMimeType` / `imageDataUrl` は載せない — これらは既に
 * 新規には書かれておらず、しかも `imageBlobCid` + `imageBlobMimeType` →
 * `app.conversensus.image` は 2 キーから 1 構造体への変換であって名前の付け替えでは
 * ない。その互換読みは `imageBlob.ts` の `readImageBlobLocation` が持つ。
 */
const LEGACY_PROPERTY_NAMES: Readonly<Record<string, PropertyName>> = {
  image: `${SYSTEM_PROPERTY_PREFIX}image`,
  imageUrl: `${SYSTEM_PROPERTY_PREFIX}imageUrl`,
};

/** 旧名なら新名を、そうでなければそのままを返す */
export function canonicalPropertyName(name: PropertyName): PropertyName {
  return LEGACY_PROPERTY_NAMES[name] ?? name;
}

/**
 * properties のキーをすべて新名へ寄せる。
 *
 * 新旧が両方載っている場合は**新名が勝つ**。移行期には「旧名のまま残っている値」の上に
 * 新名で書き足す経路があり (画像 URL の編集など)、そこで新しい方が旧い方に上書きされて
 * しまうと編集が消えるためである。
 */
export function canonicalProperties(
  properties: Properties | undefined,
): Properties | undefined {
  if (!properties) return properties;
  const legacyNames = Object.keys(properties).filter(
    (name) => name in LEGACY_PROPERTY_NAMES,
  );
  if (legacyNames.length === 0) return properties;

  const next: Properties = {};
  // 新名を先に置き、旧名は行き先が空いているときだけ入れる (新名が勝つ)
  for (const [name, value] of Object.entries(properties))
    if (!(name in LEGACY_PROPERTY_NAMES)) next[name] = value;
  for (const name of legacyNames) {
    const canonical = LEGACY_PROPERTY_NAMES[name];
    if (!(canonical in next)) next[canonical] = properties[name];
  }
  return next;
}

/**
 * プロパティの種類 (`deepse/requirements/spec/propertyEditor.md`「名前」)
 *
 * 可視性と変更可能性がここで決まる — system は見えず変更できない、custom は見えて
 * 変更できる、extension はその中間 (拡張側が制御する)。
 */
export type PropertyCategory = 'system' | 'extension' | 'custom';

/**
 * 名前からプロパティの種類を判定する。
 *
 * 仕様の判定規則は **「名前が `.` を含むか否か」の一点**である。`.` を含まない名前は
 * すべて custom で、含むものは名前空間を持つ = system か extension になる。
 * system はそのうち `app.conversensus.` で始まるもの (本体のもの) だけである。
 *
 * **template は extension である** — 本体のものではないので system の枠には入らない
 * (仕様「実際に使われている extension」)。
 */
export function propertyCategory(name: PropertyName): PropertyCategory {
  if (name.startsWith(SYSTEM_PROPERTY_PREFIX)) return 'system';
  return name.includes('.') ? 'extension' : 'custom';
}

/**
 * プロパティの型 (`deepse/requirements/spec/propertyEditor.md`「型制約」)
 *
 * 仕様が挙げる型のうち**ユニオン・リテラル (`|`) は無い** — ユニオンは「取りうる値の
 * 集合」を述べるものなので、値 1 つからは推論できない。型を保存する語彙ができる
 * step 3 で初めて存在しうる。
 *
 * 逆に `object` は仕様の一覧に無いが**要る** — `app.conversensus.image` が構造体
 * (`{cid, mimeType, size}`) だからである (仕様「`image` だけは構造体なので, 型の扱いを
 * 別に決める必要がある」)。
 */
export type PropertyType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'array'
  | 'object';

/** `YYYY-MM-DD`。**日付だけ**で時刻を伴わないもの */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** `YYYY-MM-DDThh:mm` 以降。区切りは ISO 8601 の `T` と、実地で書かれる空白を許す */
const DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/**
 * 値から型を推論する。
 *
 * **step 2 に「型が先に決まっている」状態は存在しない** (仕様 =「型は値の従属変数で
 * ある」)。`node.setProperty` / `edge.setProperty` は `{名前, 値}` であって型を運ばない
 * ので、型を知る道はここしかない。**property editor (Phase 4) と検索の結果一覧
 * (Phase 7) が同じ型を表示する**ための唯一の定義である。
 *
 * 値が無い (`undefined` / `null`) ときは `string` とする。「型が無い」を表に出すと
 * 表示側が空欄を扱わねばならなくなるが、値の無いプロパティは step 2 では削除と
 * 同じ意味なので、区別する利得が無い。
 */
export function inferPropertyType(value: unknown): PropertyType {
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') {
    // **2 つのパターンは排他的なので、順序は結果を変えない** (変異で確認した)。
    // `DATE_PATTERN` が `$` で終端を留めているため、日時の文字列には当たらないからである。
    // **効いているのは順序ではなく終端の留めの方**で、`$` を外すと初めて順序に意味が
    // 出る (そして日時が date になる)。動かしてはならないのは `$` である
    if (DATETIME_PATTERN.test(value)) return 'datetime';
    if (DATE_PATTERN.test(value)) return 'date';
    return 'string';
  }
  if (value !== null && typeof value === 'object') return 'object';
  return 'string';
}

/** プロパティ 1 つの変更。`value` の省略はそのプロパティの**削除** */
export type PropertyChange = { name: PropertyName; value?: unknown };

/**
 * 値の同一性。キーの順序に左右されないよう値ごとに JSON で比べる
 * (client の `computeOperations.sameProperties` と同じ規則)。
 */
function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 置換の意味論で書かれた from → to を、キー単位の変更の列にする。
 *
 * `to` に無く `from` にあるキーは削除 (`value` を省略) になる。`undefined` と `{}` は
 * どちらも「プロパティが無い」として同じに扱う。
 *
 * **両側を新名へ寄せてから比べる** (#137)。旧名のまま残っているノードに新名で書き足す
 * 経路があり、寄せずに比べると「旧名の削除 + 新名の追加」という 2 件の変更になって
 * しまう。同じプロパティの変更は 1 件の op であるべきで、そうでないと merge の
 * 競合単位も割れる。
 */
export function diffProperties(
  from: Properties | undefined,
  to: Properties | undefined,
): PropertyChange[] {
  const before = canonicalProperties(from) ?? {};
  const after = canonicalProperties(to) ?? {};
  const changes: PropertyChange[] = [];

  for (const name of Object.keys(after))
    if (!sameValue(before[name], after[name]))
      changes.push({ name, value: after[name] });

  for (const name of Object.keys(before))
    if (!(name in after)) changes.push({ name });

  return changes;
}

/**
 * 変更を 1 つ当てた properties を返す (元は変更しない)。値の省略はキーの削除。
 *
 * **変更の名前も当てる先も新名へ寄せる** (#137)。旧名の op-log と旧名を持つノードの
 * どちらから来ても、結果のグラフには新名しか現れない。
 */
export function applyPropertyChange(
  properties: Properties | undefined,
  change: PropertyChange,
): Properties {
  const next = { ...canonicalProperties(properties) };
  const name = canonicalPropertyName(change.name);
  if (change.value === undefined) delete next[name];
  else next[name] = change.value;
  return next;
}

/**
 * 変更の列を順に当てた properties を返す (元は変更しない)
 *
 * **初期値も新名へ寄せる** (#137)。`applyPropertyChange` は毎回寄せるので、寄せずに
 * 始めると「変更が 1 件以上あるときだけ結果が正規化される」という非対称になる。
 * 変更 0 件は「何も起きない」ではなく「何も変えずに寄せる」である。
 * (性質検証で見つけた: `from = to = { image: 'x' }` で往復が成り立たなかった)
 */
export function applyPropertyChanges(
  properties: Properties | undefined,
  changes: PropertyChange[],
): Properties {
  return changes.reduce(applyPropertyChange, {
    ...canonicalProperties(properties),
  });
}
