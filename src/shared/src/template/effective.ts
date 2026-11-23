/**
 * 実効の property: 要素の property と template から、読むときの値を求める (template-update K8・K12、計画 T7)
 *
 * template の既定値は、作成時に写さず**読むときに補う** (K12)。そうすれば template を直したとき、値を設定して
 * いない要素にも新しい既定値が効く。editable: false の property は**値が常に template の既定値**である (K8)。
 * 型を宣言した property には、値が型に合うかの判定を添える (K9)。合わない値を落としたり書き換えたりはしない (K2)。
 *
 * **補うのは template の作者が書いた property (`${templateId}.<名前>`、K7) だけ**である。module や system が
 * 配る名前空間付きの既定値 (依頼の宛先 `app.conversensus.request.addressee` など) は、要素ごとの状態であり、
 * 印 (宛先を持つ node が依頼) でもあるので、今までどおり作成時に写す (`copiedDefaultsOf`)。
 */

import type { PropertyName } from '../events/unified';
import type { TemplateId } from '../schemas';
import { kindPropertyOf } from './kind';
import type { PropertySchemaEntry } from './propertySchema';
import { checkPropertyValue, parsePropertyType } from './propertyType';
import type { EdgeKind, NodeKind, Template } from './types';

/** 値の出どころ */
export type EffectiveSource =
  /** 要素自身の値 */
  | 'own'
  /** 要素に値が無く、template の既定値を補った (既定値も無ければ値は undefined) */
  | 'default'
  /** editable: false。要素の値に関わらず template の既定値 */
  | 'fixed';

/** template が配った property 1 つの、読むときの姿 */
export type EffectiveEntry = {
  value: unknown;
  source: EffectiveSource;
  /** 型を宣言していて、その型が読めるときだけ: 値が型に合うか */
  check?: 'ok' | 'missing' | 'mismatch';
  /** 宣言した型の文字列 (読めるときだけ)。画面が型に合わせた入力欄を出すのに使う */
  type?: string;
};

/** template の名前空間に入れた名前か (`${templateId}.<名前>`。種別 property は除く) */
function inNamespace(templateId: TemplateId, name: PropertyName): boolean {
  return (
    name.startsWith(`${templateId}.`) && name !== kindPropertyOf(templateId)
  );
}

/**
 * 作成時に写す既定値: template の名前空間の外のもの (module や system が配る、名前空間付きの既定値)。
 * template の作者が書いた property は写さず、読むときに補う (`effectiveTemplateProperties`)
 */
export function copiedDefaultsOf(
  templateId: TemplateId,
  kind: Pick<NodeKind | EdgeKind, 'defaults'>,
): Record<PropertyName, unknown> {
  return Object.fromEntries(
    Object.entries(kind.defaults).filter(
      ([name]) => !inNamespace(templateId, name),
    ),
  );
}

function kindOf(
  template: Template,
  element: 'node' | 'edge',
  properties: Readonly<Record<PropertyName, unknown>>,
): NodeKind | EdgeKind | undefined {
  const id = properties[kindPropertyOf(template.id)];
  if (typeof id !== 'string') return undefined;
  const kinds: readonly (NodeKind | EdgeKind)[] =
    element === 'node' ? template.nodeKinds : template.edgeKinds;
  return kinds.find((k) => k.id === id);
}

function entryOf(
  own: unknown,
  fallback: unknown,
  schema: PropertySchemaEntry | undefined,
): EffectiveEntry {
  const editable = schema?.editable ?? true;
  const [value, source]: [unknown, EffectiveSource] = !editable
    ? [fallback, 'fixed']
    : own !== undefined
      ? [own, 'own']
      : [fallback, 'default'];
  const type = schema?.type;
  const parsed = type === undefined ? undefined : parsePropertyType(type);
  return {
    value,
    source,
    ...(parsed?.ok && {
      check: checkPropertyValue(parsed.decl, value),
      type,
    }),
  };
}

/**
 * 要素の種類が配る property の、読むときの姿。キーは property の名前 (`${templateId}.<名前>`)。
 * 種類を持たない要素・知らない種類では空。複数の template の種類を持つときは、先に当たった template が勝つ
 */
export function effectiveTemplateProperties(
  templates: readonly Template[],
  element: 'node' | 'edge',
  properties: Readonly<Record<PropertyName, unknown>> | undefined,
): Record<PropertyName, EffectiveEntry> {
  const own = properties ?? {};
  const entries: Record<PropertyName, EffectiveEntry> = {};
  for (const t of templates) {
    const kind = kindOf(t, element, own);
    if (!kind) continue;
    const names = new Set(
      [...Object.keys(kind.defaults), ...Object.keys(kind.schema)].filter(
        (name) => inNamespace(t.id, name),
      ),
    );
    for (const name of names) {
      if (Object.hasOwn(entries, name)) continue;
      entries[name] = entryOf(
        Object.hasOwn(own, name) ? own[name] : undefined,
        kind.defaults[name],
        kind.schema[name],
      );
    }
  }
  return entries;
}

/**
 * 読むときの property の全体: 要素の property に、template の既定値を補い、editable: false の値を template の
 * 値にしたもの。**値の無いもの (既定値も無い宣言) は含めない**
 */
export function effectiveProperties(
  templates: readonly Template[],
  element: 'node' | 'edge',
  properties: Readonly<Record<PropertyName, unknown>> | undefined,
): Record<PropertyName, unknown> {
  const result: Record<PropertyName, unknown> = { ...properties };
  for (const [name, entry] of Object.entries(
    effectiveTemplateProperties(templates, element, properties),
  )) {
    if (entry.value === undefined) delete result[name];
    else result[name] = entry.value;
  }
  return result;
}
