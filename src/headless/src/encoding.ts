/**
 * agent に読ませる、graph の完全な encoding (agent 段 3 M1, 設計 D4)
 *
 * File の trunk の projection (`GraphFile`) を、**欠けなく**行指向のテキストに落とす。
 * 人間が読むための graphdown とは目的が違う — こちらは id を残し、property も layout も落とさない。
 * agent は書く道具に id を渡して、ここに書かれた node・edge を指す。
 *
 * ## 形
 *
 * ```text
 * file <fileId>
 *   name "File の名前"
 * sheet <sheetId>
 *   name "議論"
 *   template-ref {"sheet":"…","at":12}
 *   # template "toulmin" (template.…): node 種別 "主張"=<kindId> …
 *   node <nodeId>
 *     content "週休 3 日にする"
 *     # 種別: "主張" (template "toulmin")
 *     prop "template.….kind" "<kindId>"
 *     layout {"x":120,"y":80}
 *   edge <edgeId> <sourceId> -> <targetId>
 *     label "支える"
 * ```
 *
 * - **値は JSON で書く** (文字列は JSON の文字列)。改行や `"` を含む本文でも行が崩れず、
 *   読み戻しが一意になる
 * - **`#` で始まる行は注釈**である。template の種別の一覧・種別の名前・property の種類 (system は
 *   書き換えない) など、graph から導けるものを読みやすく添える。情報は持たない — 注釈を除いた
 *   行だけから元の `GraphFile` が復元できる (`encoding.test.ts` の性質)
 * - 逆向き (テキスト → graph) は作らない。書くのは op である (D4)
 */

import {
  type GraphEdge,
  type GraphFile,
  type GraphNode,
  isKindProperty,
  kindPropertyOf,
  propertyCategory,
  type Sheet,
  type Template,
} from '@conversensus/shared';

/** sheet に当たっている template の実体 (種別の名前を引くため)。解決は呼ぶ側が持つ */
export type TemplatesOf = (sheet: Sheet) => readonly Template[];

/** 入れ子 1 段の字下げ */
const INDENT = '  ';
/** 値を書く (JSON。文字列は引用符と escape が付く) */
const value = (v: unknown): string => JSON.stringify(v);

/** property の種類ごとの注釈。system は本体のもので、agent が書き換えるものではない */
const CATEGORY_NOTE = {
  system: 'system (本体のもの。書き換えない)',
  extension: 'extension',
  custom: 'custom',
} as const;

function propertyLines(
  properties: Record<string, unknown> | undefined,
  depth: string,
  templates: readonly Template[],
): string[] {
  const lines: string[] = [];
  for (const [name, v] of Object.entries(properties ?? {})) {
    lines.push(`${depth}# ${noteOf(name, v, templates)}`);
    lines.push(`${depth}prop ${value(name)} ${value(v)}`);
  }
  return lines;
}

/** property の注釈: 種別プロパティなら種別の名前、そうでなければ property の種類 */
function noteOf(
  name: string,
  v: unknown,
  templates: readonly Template[],
): string {
  if (isKindProperty(name)) {
    for (const t of templates) {
      if (kindPropertyOf(t.id) !== name) continue;
      const kind =
        t.nodeKinds.find((k) => k.id === v) ??
        t.edgeKinds.find((k) => k.id === v);
      if (kind) return `種別: ${value(kind.label)} (template ${value(t.name)})`;
    }
    return '種別 (template を引けない)';
  }
  return CATEGORY_NOTE[propertyCategory(name)];
}

/** layout から、どの要素のものかを示す id を除いたもの。空なら書かない */
function layoutLine(
  layout: Record<string, unknown> | undefined,
  idKey: 'nodeId' | 'edgeId',
  depth: string,
): string[] {
  if (!layout) return [];
  const { [idKey]: _, ...rest } = layout;
  return Object.keys(rest).length === 0
    ? []
    : [`${depth}layout ${value(rest)}`];
}

function templateNote(t: Template): string {
  const nodes = t.nodeKinds.map((k) => `${value(k.label)}=${k.id}`).join(', ');
  const edges = t.edgeKinds.map((k) => `${value(k.label)}=${k.id}`).join(', ');
  return `# template ${value(t.name)} (${t.id}): node 種別 ${nodes || 'なし'} / edge 種別 ${edges || 'なし'}`;
}

/** template の種別の説明 (template graph の本文)。agent への種類ごとの指示になる (D13) */
function kindDescriptionNotes(t: Template, depth: string): string[] {
  return t.nodeKinds
    .filter((k) => k.description)
    .map((k) => `${depth}#   ${value(k.label)}: ${value(k.description)}`);
}

function nodeLines(
  node: GraphNode,
  layout: Record<string, unknown> | undefined,
  templates: readonly Template[],
): string[] {
  const depth = INDENT.repeat(2);
  return [
    `${INDENT}node ${node.id}`,
    `${depth}content ${value(node.content)}`,
    ...(node.label !== undefined ? [`${depth}label ${value(node.label)}`] : []),
    ...(node.nodeType ? [`${depth}type ${value(node.nodeType)}`] : []),
    ...(node.parentId ? [`${depth}parent ${node.parentId}`] : []),
    ...propertyLines(node.properties, depth, templates),
    ...layoutLine(layout, 'nodeId', depth),
  ];
}

function edgeLines(
  edge: GraphEdge,
  layout: Record<string, unknown> | undefined,
  templates: readonly Template[],
): string[] {
  const depth = INDENT.repeat(2);
  return [
    `${INDENT}edge ${edge.id} ${edge.source} -> ${edge.target}`,
    ...(edge.label !== undefined ? [`${depth}label ${value(edge.label)}`] : []),
    ...propertyLines(edge.properties, depth, templates),
    ...layoutLine(layout, 'edgeId', depth),
  ];
}

function sheetLines(sheet: Sheet, templates: readonly Template[]): string[] {
  const nodeLayouts = new Map(sheet.layouts?.map((l) => [l.nodeId, l]));
  const edgeLayouts = new Map(sheet.edgeLayouts?.map((l) => [l.edgeId, l]));
  // 対応する node・edge の無い layout も落とさない (欠けなく、のため)
  const orphanNodeLayouts = (sheet.layouts ?? []).filter(
    (l) => !sheet.nodes.some((n) => n.id === l.nodeId),
  );
  const orphanEdgeLayouts = (sheet.edgeLayouts ?? []).filter(
    (l) => !sheet.edges.some((e) => e.id === l.edgeId),
  );
  return [
    `sheet ${sheet.id}`,
    `${INDENT}name ${value(sheet.name)}`,
    ...(sheet.description !== undefined
      ? [`${INDENT}description ${value(sheet.description)}`]
      : []),
    ...(sheet.templateIds ?? []).map(
      (ref) => `${INDENT}template-ref ${value(ref)}`,
    ),
    ...templates.flatMap((t) => [
      `${INDENT}${templateNote(t)}`,
      ...kindDescriptionNotes(t, INDENT),
    ]),
    ...propertyLines(sheet.properties, INDENT, templates),
    ...sheet.nodes.flatMap((n) =>
      nodeLines(n, nodeLayouts.get(n.id), templates),
    ),
    ...sheet.edges.flatMap((e) =>
      edgeLines(e, edgeLayouts.get(e.id), templates),
    ),
    ...orphanNodeLayouts.map((l) => `${INDENT}node-layout ${value(l)}`),
    ...orphanEdgeLayouts.map((l) => `${INDENT}edge-layout ${value(l)}`),
  ];
}

/** File を完全な encoding に落とす */
export function encodeFile(
  file: GraphFile,
  templatesOf: TemplatesOf = () => [],
): string {
  return [
    `file ${file.id}`,
    `${INDENT}name ${value(file.name)}`,
    ...(file.description !== undefined
      ? [`${INDENT}description ${value(file.description)}`]
      : []),
    ...file.sheets.flatMap((s) => sheetLines(s, templatesOf(s))),
  ].join('\n');
}
