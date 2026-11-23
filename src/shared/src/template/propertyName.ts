/**
 * template が配る property の、適用先での名前 (template-update K7、計画 T6)
 *
 * template graph には property を **prefix 無しで** (`期限`) 書く。適用先では、それを template の名前空間に入れて
 * `${templateId}.期限` にする。prefix が無いと、2 つの template が同じ名前の property を配ったときや、利用者が
 * 自分で同じ名前の custom の property を付けたときに、名前が衝突する。
 *
 * - **名前空間を持つ名前 (`.` を含む) はそのまま**。system (`app.conversensus.*`) や拡張の名前は、既に誰の
 *   ものかを名前が言っている
 * - template の id は種別 property (`${templateId}.kind`) の名前空間でもある。そこで **`kind` という名前は
 *   template の property に使えない** (種別 property と同じ名前になる)。template graph に書かれても配らない
 * - 表示は prefix を外し、template の名前を添える (`templatePropertyLabels`)
 */

import type { PropertyName } from '../events/unified';
import type { TemplateId } from '../schemas';

/** template の property に使えない名前 (種別 property `${templateId}.kind` と同じ名前になる) */
export const RESERVED_TEMPLATE_PROPERTY_NAMES: readonly string[] = ['kind'];

/** template graph に書かれた名前が、template の property として使えないか */
export function isReservedTemplatePropertyName(name: PropertyName): boolean {
  return RESERVED_TEMPLATE_PROPERTY_NAMES.includes(name);
}

/** template graph に書かれた名前 → 適用先での名前。名前空間を持つ名前はそのまま */
export function appliedPropertyNameOf(
  templateId: TemplateId,
  name: PropertyName,
): PropertyName {
  return name.includes('.') ? name : `${templateId}.${name}`;
}

/**
 * 適用先での名前 → template graph に書く名前 (`appliedPropertyNameOf` の逆、種の複製で使う)。
 * その template の名前空間に入れた名前でなければそのまま
 */
export function writtenPropertyNameOf(
  templateId: TemplateId,
  name: PropertyName,
): PropertyName {
  const prefix = `${templateId}.`;
  if (!name.startsWith(prefix)) return name;
  const rest = name.slice(prefix.length);
  return rest !== '' && !rest.includes('.') ? rest : name;
}

/** template の property の、人が読める形: どの template の・何という名前か */
export type TemplatePropertyLabel = { template: string; name: string };

/**
 * 要素の property のうち template が配ったもの (`${templateId}.<名前>`) を、人が読める形にする。
 * 種別 property (`.kind`) と、知らない template のものは含めない (名前のまま出す)
 */
export function templatePropertyLabels(
  templates: readonly { id: TemplateId; name: string }[],
  properties: Readonly<Record<PropertyName, unknown>> | undefined,
): Record<PropertyName, TemplatePropertyLabel> {
  const labels: Record<PropertyName, TemplatePropertyLabel> = {};
  for (const name of Object.keys(properties ?? {})) {
    for (const t of templates) {
      const written = writtenPropertyNameOf(t.id, name);
      if (written === name || isReservedTemplatePropertyName(written)) continue;
      labels[name] = { template: t.name, name: written };
      break;
    }
  }
  return labels;
}
