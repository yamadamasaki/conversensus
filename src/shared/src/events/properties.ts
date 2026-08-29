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

/** 変更の列を順に当てた properties を返す (元は変更しない) */
export function applyPropertyChanges(
  properties: Properties | undefined,
  changes: PropertyChange[],
): Properties {
  return changes.reduce(applyPropertyChange, { ...properties });
}
