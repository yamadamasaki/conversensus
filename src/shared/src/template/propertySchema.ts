/**
 * template の property の宣言: 型と editable (template-update K9、計画 T5)
 *
 * 宣言は template graph の種類の node/edge の**付随 property** に置く。名前は
 * `app.conversensus.propertySchema.<property の名前>`、値は `{ type?, editable? }`。
 *
 * - op の語彙を増やさない (step3 の「op 語彙はコアが閉じる」)。言語ごとの名前 (`label:<言語>`、#356) と同じ流儀
 * - system の名前空間に置くのは、宣言が template graph の**中身ではなく template の定義**だからである。
 *   既定値と違い、適用先へは写さない (`templateFromSheet` の既定値から除く)
 * - `type` は `propertyType.ts` の文法の文字列。**読めない文字列も捨てずに持つ** — template graph の画面で
 *   誤りを見せて直させるため。使う側は `parsePropertyType` で読み、読めなければ型の無い property として扱う
 * - `editable` は既定で true。false なら「値は常に template の既定値」(K8)
 */

import { z } from 'zod';
import { SYSTEM_PROPERTY_PREFIX } from '../events/properties';
import type { PropertyName } from '../events/unified';

/** 宣言の property 名の前置き */
export const PROPERTY_SCHEMA_PREFIX = `${SYSTEM_PROPERTY_PREFIX}propertySchema.`;

export const PropertySchemaEntrySchema = z.object({
  type: z.string().optional(),
  editable: z.boolean().default(true),
});
/** property 1 つの宣言 */
export type PropertySchemaEntry = z.infer<typeof PropertySchemaEntrySchema>;

/** 種類ごとの宣言。キーは template graph に書かれた property の名前 */
export const PropertySchemaSchema = z
  .record(z.string(), PropertySchemaEntrySchema)
  .default({});
export type PropertySchema = z.infer<typeof PropertySchemaSchema>;

/** その property の宣言を置く property の名前 */
export function propertySchemaPropertyOf(name: PropertyName): PropertyName {
  return `${PROPERTY_SCHEMA_PREFIX}${name}`;
}

/** 宣言の property か */
export function isPropertySchemaProperty(name: PropertyName): boolean {
  return (
    name.startsWith(PROPERTY_SCHEMA_PREFIX) &&
    name.length > PROPERTY_SCHEMA_PREFIX.length
  );
}

/**
 * properties から宣言を読む。**読めない値は黙って落とす** — 他の参加者の新しい書き方でも template を
 * 読めるべきだから (`sheetKindOf` と同じ判断)
 */
export function propertySchemaIn(
  properties: Readonly<Record<PropertyName, unknown>> | undefined,
): PropertySchema {
  const schema: PropertySchema = {};
  for (const [name, value] of Object.entries(properties ?? {})) {
    if (!isPropertySchemaProperty(name)) continue;
    const parsed = PropertySchemaEntrySchema.safeParse(value);
    if (parsed.success) {
      schema[name.slice(PROPERTY_SCHEMA_PREFIX.length)] = parsed.data;
    }
  }
  return schema;
}

/**
 * 宣言を、置く値の形にする。**何も宣言していない (型が無く editable) なら undefined** — その property を
 * 消してよい。既定と同じ宣言を残すと、template graph に意味の無い property が溜まる
 */
export function propertySchemaValueOf(
  entry: PropertySchemaEntry,
): PropertySchemaEntry | undefined {
  const type = entry.type?.trim();
  if ((type === undefined || type === '') && entry.editable) return undefined;
  return {
    ...(type !== undefined && type !== '' && { type }),
    editable: entry.editable,
  };
}

/** 宣言を property にする (種の template graph に書くとき、`templateGraphOf`) */
export function propertySchemaProperties(
  schema: PropertySchema,
): Record<PropertyName, unknown> {
  const properties: Record<PropertyName, unknown> = {};
  for (const [name, entry] of Object.entries(schema)) {
    const value = propertySchemaValueOf(entry);
    if (value) properties[propertySchemaPropertyOf(name)] = value;
  }
  return properties;
}
