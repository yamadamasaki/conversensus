/**
 * agent が書くための道具: 引数 → GraphEvent (agent 段 3 M2, 設計 D4)
 *
 * 道具 1 回 = GraphEvent 1 つ = op の batch 1 つ。GraphEvent は `graphEventToOps` で既存の op に
 * 落ちる (UI と同じ経路、段 2 §5)。agent 専用の op は作らない (step3 D3)。
 *
 * 道具は**今の Sheet と、当たっている template を見て検める**。UI ができないことは道具もできない
 * (設計 §1.1: agent と人間を対等に扱う):
 *
 * - 種別は **node・edge を作るときにだけ**付ける。後から変えない (UI も作成時に決めて変えない)
 * - 種別プロパティと system の property (`app.conversensus.*`) は書き換えない
 * - edge の種別は、両端の種別から引く候補 (`edgeKindCandidates`) に従う。候補が 1 つなら自動、
 *   複数なら選ばせる、同じ template の要素どうしで候補が無ければ繋げない
 *
 * ここは純粋な関数である。読む (projection と template の解決) のと書く (`Headless.record`) のは
 * 呼ぶ側 (MCP server) が持つ。
 */

import type { GraphEvent } from '@conversensus/client/src/events/GraphEvent';
import {
  DEFAULT_NODE_STYLE,
  GROUP_PADDING,
  GROUP_TITLE_HEIGHT,
} from '@conversensus/client/src/nodeGeometry';
import {
  type EdgeId,
  edgeKindCandidates,
  type GraphEdge,
  type GraphNode,
  isKindProperty,
  isTemplateEdge,
  kindPropertyOf,
  type NodeId,
  type NodeLayout,
  nodeKindsOf,
  propertyCategory,
  type Sheet,
  type Template,
} from '@conversensus/shared';

/** 道具が見るもの: 書く先の Sheet (trunk の今) と、そこに当たっている template */
export type ToolContext = { sheet: Sheet; templates: readonly Template[] };

/** 自動で置くときの、node と node の縦の間 */
const AUTO_PLACE_GAP = 40;

/** 道具が受け付けないとき。agent に理由を返す */
export class ToolError extends Error {}

function eventBase<C extends GraphEvent['category']>(category: C) {
  return { id: crypto.randomUUID(), timestamp: Date.now(), category };
}

function nodeOf(ctx: ToolContext, nodeId: string): GraphNode {
  const node = ctx.sheet.nodes.find((n) => n.id === nodeId);
  if (!node) throw new ToolError(`この Sheet に node ${nodeId} は無い`);
  return node;
}

function edgeOf(ctx: ToolContext, edgeId: string): GraphEdge {
  const edge = ctx.sheet.edges.find((e) => e.id === edgeId);
  if (!edge) throw new ToolError(`この Sheet に edge ${edgeId} は無い`);
  return edge;
}

/** agent が書いてよい property か。種別と system は本体・template のもの */
function assertWritable(name: string): void {
  if (isKindProperty(name)) {
    throw new ToolError(`${name} は種別で、作った後は変えられない`);
  }
  if (propertyCategory(name) === 'system') {
    throw new ToolError(`${name} は本体の property で、書き換えられない`);
  }
}

const heightOf = (layout: NodeLayout | undefined): number =>
  typeof layout?.height === 'number'
    ? layout.height
    : DEFAULT_NODE_STYLE.height;

/**
 * 位置が無いときに置く所: 同じ親の下の node のうち一番下のものの、さらに下。
 * group の中の位置は親からの相対なので、子は枠の内側から始める
 */
export function autoPlace(
  sheet: Sheet,
  parentId: NodeId | undefined,
): { x: number; y: number } {
  const layouts = new Map(sheet.layouts?.map((l) => [l.nodeId, l]));
  const start = parentId
    ? { x: GROUP_PADDING, y: GROUP_TITLE_HEIGHT + GROUP_PADDING }
    : { x: 0, y: 0 };
  const siblings = sheet.nodes
    .filter((n) => n.parentId === parentId)
    .map((n) => layouts.get(n.id))
    .filter((l): l is NodeLayout => typeof l?.y === 'number');
  if (siblings.length === 0) return start;
  const bottom = Math.max(
    ...siblings.map((l) => (l.y as number) + heightOf(l)),
  );
  const left = Math.min(
    ...siblings.map((l) => (typeof l.x === 'number' ? l.x : start.x)),
  );
  return { x: left, y: bottom + AUTO_PLACE_GAP };
}

export type AddNodeArgs = {
  content: string;
  /** 種別の id (encoding の `# template` の行にある)。省略は種別なし */
  kind?: string;
  properties?: Record<string, unknown>;
  /** 入れる group */
  parentId?: string;
  x?: number;
  y?: number;
};

/** node を足す (`node.add` + 位置の `node.setLayout`) */
export function addNode(
  ctx: ToolContext,
  args: AddNodeArgs,
): { event: GraphEvent; nodeId: NodeId } {
  for (const name of Object.keys(args.properties ?? {})) assertWritable(name);
  let parentId: NodeId | undefined;
  if (args.parentId !== undefined) {
    const parent = nodeOf(ctx, args.parentId);
    if (parent.nodeType !== 'group') {
      throw new ToolError(`node ${args.parentId} は group ではない`);
    }
    parentId = parent.id;
  }
  const kind =
    args.kind === undefined
      ? undefined
      : nodeKindsOf(ctx.templates).find((k) => k.kind.id === args.kind);
  if (args.kind !== undefined && !kind) {
    throw new ToolError(`この Sheet の template に種別 ${args.kind} は無い`);
  }
  const properties = {
    ...args.properties,
    // 種類の既定値を先に、種別を最後に置く (UI と同じ。既定値に種別の名前が紛れても種別が勝つ)
    ...(kind && {
      ...kind.kind.defaults,
      [kindPropertyOf(kind.templateId)]: kind.kind.id,
    }),
  };
  const nodeId = crypto.randomUUID() as NodeId;
  const data: GraphNode = {
    id: nodeId,
    content: args.content,
    ...(kind && { label: kind.kind.label }),
    ...(Object.keys(properties).length > 0 && { properties }),
    ...(parentId && { parentId }),
  };
  const at =
    args.x !== undefined && args.y !== undefined
      ? { x: args.x, y: args.y }
      : autoPlace(ctx.sheet, parentId);
  return {
    nodeId,
    event: {
      ...eventBase('structure'),
      type: 'NODE_ADDED',
      nodeId,
      data,
      layout: { nodeId, ...at, ...DEFAULT_NODE_STYLE },
    },
  };
}

/** node の本文を変える (`node.setContent`) */
export function setNodeContent(
  ctx: ToolContext,
  args: { nodeId: string; content: string },
): GraphEvent {
  const node = nodeOf(ctx, args.nodeId);
  return {
    ...eventBase('content'),
    type: 'NODE_CONTENT_CHANGED',
    nodeId: node.id,
    from: node.content,
    to: args.content,
  };
}

/** properties の 1 つを変える。value が無ければ消す */
function withProperty(
  properties: Record<string, unknown> | undefined,
  name: string,
  value: unknown,
): Record<string, unknown> {
  const { [name]: _, ...rest } = properties ?? {};
  return value === undefined ? rest : { ...rest, [name]: value };
}

/** node の property を 1 つ書く・消す (`node.setProperty`) */
export function setNodeProperty(
  ctx: ToolContext,
  args: { nodeId: string; name: string; value?: unknown },
): GraphEvent {
  assertWritable(args.name);
  const node = nodeOf(ctx, args.nodeId);
  return {
    ...eventBase('content'),
    type: 'NODE_PROPERTIES_CHANGED',
    nodeId: node.id,
    from: node.properties ?? {},
    to: withProperty(node.properties, args.name, args.value),
  };
}

/** node を動かす (`node.setLayout`)。group の中では親からの相対 */
export function moveNode(
  ctx: ToolContext,
  args: { nodeId: string; x: number; y: number },
): GraphEvent {
  const node = nodeOf(ctx, args.nodeId);
  const layout = ctx.sheet.layouts?.find((l) => l.nodeId === node.id);
  return {
    ...eventBase('layout'),
    type: 'NODE_MOVED',
    nodeId: node.id,
    from: { x: layout?.x ?? 0, y: layout?.y ?? 0 },
    to: { x: args.x, y: args.y },
  };
}

/** node を消す (`node.remove`)。繋がった edge は畳み込みが一緒に消す (cascade) */
export function removeNode(
  ctx: ToolContext,
  args: { nodeId: string },
): GraphEvent {
  const node = nodeOf(ctx, args.nodeId);
  return {
    ...eventBase('structure'),
    type: 'NODE_DELETED',
    nodeId: node.id,
    data: node,
  };
}

export type AddEdgeArgs = {
  source: string;
  target: string;
  /** edge の種別の id。候補が 1 つなら省略してよい */
  kind?: string;
  /** 種別の無い edge の label */
  label?: string;
  properties?: Record<string, unknown>;
};

/** edge を足す (`edge.add`)。種別は両端の種別から引く (UI と同じ規則) */
export function addEdge(
  ctx: ToolContext,
  args: AddEdgeArgs,
): { event: GraphEvent; edgeId: EdgeId } {
  for (const name of Object.keys(args.properties ?? {})) assertWritable(name);
  const source = nodeOf(ctx, args.source);
  const target = nodeOf(ctx, args.target);
  const candidates = edgeKindCandidates(
    ctx.templates,
    source.properties,
    target.properties,
  );
  const listed = () =>
    candidates
      .map((c) => `${JSON.stringify(c.kind.label)}=${c.kind.id}`)
      .join(', ');
  let kind = candidates.find((c) => c.kind.id === args.kind);
  if (args.kind !== undefined && !kind) {
    throw new ToolError(
      `種別 ${args.kind} はこの両端に使えない。使えるのは: ${listed() || 'なし'}`,
    );
  }
  if (!kind && candidates.length === 1) kind = candidates[0];
  if (!kind && candidates.length > 1) {
    throw new ToolError(`種別を選んでください: ${listed()}`);
  }
  if (
    !kind &&
    isTemplateEdge(ctx.templates, source.properties, target.properties)
  ) {
    throw new ToolError('この両端の種別の組は、template の規則で繋げない');
  }
  if (kind && args.label !== undefined) {
    throw new ToolError(
      '種別のある edge の label は種別の名前になる。label は渡さない',
    );
  }
  const properties = {
    ...args.properties,
    ...(kind && {
      ...kind.kind.defaults,
      [kindPropertyOf(kind.templateId)]: kind.kind.id,
    }),
  };
  const edgeId = crypto.randomUUID() as EdgeId;
  const label = kind ? kind.kind.label : args.label;
  const data: GraphEdge = {
    id: edgeId,
    source: source.id,
    target: target.id,
    ...(label !== undefined && label !== '' && { label }),
    ...(Object.keys(properties).length > 0 && { properties }),
  };
  return {
    edgeId,
    event: { ...eventBase('structure'), type: 'EDGE_ADDED', edgeId, data },
  };
}

/** 種別の無い edge の label を変える (`edge.setLabel`) */
export function setEdgeLabel(
  ctx: ToolContext,
  args: { edgeId: string; label: string },
): GraphEvent {
  const edge = edgeOf(ctx, args.edgeId);
  if (Object.keys(edge.properties ?? {}).some(isKindProperty)) {
    throw new ToolError(
      '種別のある edge の label は種別の名前で、変えられない',
    );
  }
  return {
    ...eventBase('content'),
    type: 'EDGE_RELABELED',
    edgeId: edge.id,
    from: edge.label ?? '',
    to: args.label,
  };
}

/** edge の property を 1 つ書く・消す (`edge.setProperty`) */
export function setEdgeProperty(
  ctx: ToolContext,
  args: { edgeId: string; name: string; value?: unknown },
): GraphEvent {
  assertWritable(args.name);
  const edge = edgeOf(ctx, args.edgeId);
  return {
    ...eventBase('content'),
    type: 'EDGE_PROPERTIES_CHANGED',
    edgeId: edge.id,
    from: edge.properties ?? {},
    to: withProperty(edge.properties, args.name, args.value),
  };
}

/** edge を消す (`edge.remove`) */
export function removeEdge(
  ctx: ToolContext,
  args: { edgeId: string },
): GraphEvent {
  const edge = edgeOf(ctx, args.edgeId);
  return {
    ...eventBase('structure'),
    type: 'EDGE_DELETED',
    edgeId: edge.id,
    data: edge,
  };
}
