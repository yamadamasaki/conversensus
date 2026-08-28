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
 */
export function diffProperties(
  from: Properties | undefined,
  to: Properties | undefined,
): PropertyChange[] {
  const before = from ?? {};
  const after = to ?? {};
  const changes: PropertyChange[] = [];

  for (const name of Object.keys(after))
    if (!sameValue(before[name], after[name]))
      changes.push({ name, value: after[name] });

  for (const name of Object.keys(before))
    if (!(name in after)) changes.push({ name });

  return changes;
}

/** 変更を 1 つ当てた properties を返す (元は変更しない)。値の省略はキーの削除 */
export function applyPropertyChange(
  properties: Properties | undefined,
  change: PropertyChange,
): Properties {
  const next = { ...properties };
  if (change.value === undefined) delete next[change.name];
  else next[change.name] = change.value;
  return next;
}

/** 変更の列を順に当てた properties を返す (元は変更しない) */
export function applyPropertyChanges(
  properties: Properties | undefined,
  changes: PropertyChange[],
): Properties {
  return changes.reduce(applyPropertyChange, { ...properties });
}
