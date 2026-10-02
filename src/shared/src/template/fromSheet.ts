/**
 * template graph → `Template` (step3 Phase 4 S4-1, 仕様 template graph)
 *
 * template graph は種別 `template` の sheet である (op の種類は足さない, architecture step3 §3.3 D3)。
 * 適用先の振る舞い (種類のメニュー・接続の可否・edge の種類の自動決定・property の候補) は
 * どれも `Template` を受けるので、**template graph の sheet を `Template` に読み替える**ことで
 * そのまま使う。
 *
 * 読み替えの規則 (仕様):
 *
 * - **label のある node** = node の種類。種類の id は NodeId (Q3)、表示名は label、説明は本文
 * - **少なくとも一方の端に label がある edge** = edge の種類。label の無い端は「任意」
 *   (`ANY_NODE_KIND`: 適用先でこの template の種別を持たない node)
 * - **label の無い node 同士の edge と、label の無い node** = 使い方の説明書き。種類にしない
 * - 種類になった node / edge の property = 適用先の既定値 (種別プロパティそのものは除く)
 */

import { projectAddress } from '../events/address';
import { sheetKindOf, TEMPLATE_SHEET_KIND } from '../events/sheetKind';
import type { Batch, PropertyName } from '../events/unified';
import type {
  FileId,
  GraphEdge,
  GraphNode,
  Sheet,
  TemplateId,
  TemplateRef,
} from '../schemas';
import { isKindProperty } from './kind';
import { BUILTIN_TEMPLATES } from './registry';
import {
  ANY_NODE_KIND,
  type EdgeKindId,
  type NodeKindId,
  type Template,
  TemplateSchema,
} from './types';

/**
 * template graph の template id (Q2)。**種別プロパティの名前空間を兼ねる** (`kindPropertyOf`) —
 * 利用者の template graph には提供者のドメインが無いので、sheet の id から作る。同じ template graph を
 * 当てたシート同士で同じ名前になり、別の template graph とは分かれる
 */
export function templateIdOf(templateSheetId: string): TemplateId {
  return `template.${templateSheetId}` as TemplateId;
}

/** 種別プロパティを除いた property (既定値にするもの) */
function defaultsOf(
  properties: Record<PropertyName, unknown> | undefined,
): Record<PropertyName, unknown> {
  return Object.fromEntries(
    Object.entries(properties ?? {}).filter(([name]) => !isKindProperty(name)),
  );
}

const labelOf = (element: GraphNode | GraphEdge): string =>
  element.label?.trim() ?? '';

/** template graph の sheet を `Template` に読み替える */
export function templateFromSheet(
  sheet: Sheet,
  templateId: TemplateId,
): Template {
  const kindNodes = sheet.nodes.filter((n) => labelOf(n) !== '');
  const kinds = new Set<string>(kindNodes.map((n) => n.id));
  const endOf = (nodeId: string): NodeKindId =>
    (kinds.has(nodeId) ? nodeId : ANY_NODE_KIND) as NodeKindId;

  return TemplateSchema.parse({
    id: templateId,
    name: sheet.name,
    nodeKinds: kindNodes.map((n) => ({
      id: n.id as string as NodeKindId,
      label: labelOf(n),
      ...(n.content.trim() !== '' && { description: n.content }),
      defaults: defaultsOf(n.properties),
    })),
    edgeKinds: sheet.edges
      .filter((e) => kinds.has(e.source) || kinds.has(e.target))
      .map((e) => ({
        id: e.id as string as EdgeKindId,
        label: labelOf(e),
        from: [endOf(e.source)],
        to: [endOf(e.target)],
        properties: Object.keys(defaultsOf(e.properties)),
        defaults: defaultsOf(e.properties),
      })),
  });
}

/**
 * シートの `templateIds` を、当てる template の実体に解決する。
 *
 * - `{ sheet, at }`: 同じ File の template graph を**その切断面**で読み (仕様: 適用する内容は適用先の
 *   生成時に決まる)、`templateFromSheet` で読み替える
 * - 作り込みの id: `BUILTIN_TEMPLATES` から引く (S4-1c で Toulmin を template graph にするまでの間)
 *
 * **解決できないものは黙って落とす** (`templatesOf` と同じ縮退): 無い sheet、種別が template でない
 * sheet、知らない id。相手の作ったシートを開けなくなるより、種類が少し引けない方が遥かに軽い
 */
export function resolveTemplates(
  refs: readonly TemplateRef[] | undefined,
  trunk: Batch[],
  fileId: FileId,
): Template[] {
  if (!refs) return [];
  return refs.flatMap((ref): Template[] => {
    if (typeof ref === 'string') {
      return BUILTIN_TEMPLATES.filter((t) => t.id === ref);
    }
    const sheet = projectAddress(
      { fileId, sheetId: ref.sheet, branchId: null, cut: ref.at },
      { trunk },
    );
    if (!sheet || sheetKindOf(sheet) !== TEMPLATE_SHEET_KIND) return [];
    return [templateFromSheet(sheet, templateIdOf(ref.sheet))];
  });
}
