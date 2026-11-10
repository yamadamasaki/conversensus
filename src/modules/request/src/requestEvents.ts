/**
 * 応答を求める node の操作 → GraphEvent (agent 段 4 R3, 設計 agent-actor.md D7・D12)
 *
 * 送る・閉じる・開き直す・宛先を変える・答える。**system の property を書く口はここだけ**である
 * (property の欄と MCP の汎用の道具は書かせない — 計画 §5)。画面 (依頼の module の操作、`requestModule.ts`) と
 * MCP の専用の道具 (`src/headless`) の両方がここを使う。
 *
 * どれも GraphEvent 1 つ = op の batch 1 つ。**答えるは node と edge を 1 つの batch で書く** —
 * 分けると、node だけ届いて edge が届かない間、答えの無い node が宙に浮く。
 *
 * 純粋な関数で、操作できない状態なら `RequestActionError` を投げる (画面はボタンを出さず、MCP は理由を返す)。
 */

import {
  type GraphEvent,
  makeEventBase,
} from '@conversensus/client/src/events/GraphEvent';
import { NodeActionError } from '@conversensus/client/src/nodeActions/nodeAction';
import { DEFAULT_NODE_STYLE } from '@conversensus/client/src/nodeGeometry';
import type {
  Did,
  EdgeId,
  GraphEdge,
  GraphNode,
  NodeId,
  NodeLayout,
  Sheet,
} from '@conversensus/shared';
import {
  ADDRESSEE_PROPERTY,
  ANSWER_TARGET_PROPERTY,
  ANSWERS_PROPERTY,
  answersOf,
  CLOSED_PROPERTY,
  isClosed,
  isRequestNode,
  requestStatus,
  SENT_PROPERTY,
  sentCountOf,
} from './requestNode';

/** 依頼と答えの間の横の空き */
const ANSWER_GAP_X = 80;
/** 答えどうしの縦の空き */
const ANSWER_GAP_Y = 40;

/**
 * 操作できない状態で呼ばれた。node の操作の誤り (`NodeActionError`) の一つなので、画面は dialog に理由を出し、
 * MCP は理由を返す
 */
export class RequestActionError extends NodeActionError {}

function requireRequest(node: GraphNode): void {
  if (!isRequestNode(node)) {
    throw new RequestActionError(
      `node ${node.id} は応答を求める node ではない`,
    );
  }
}

/** property をいくつか変える GraphEvent 1 つ (値が undefined なら消す) */
function propertiesChanged(
  node: GraphNode,
  changes: Readonly<Record<string, unknown>>,
): GraphEvent {
  const from = node.properties ?? {};
  const to: Record<string, unknown> = { ...from };
  for (const [name, value] of Object.entries(changes)) {
    if (value === undefined) delete to[name];
    else to[name] = value;
  }
  return {
    ...makeEventBase('content'),
    type: 'NODE_PROPERTIES_CHANGED',
    nodeId: node.id,
    from,
    to,
  };
}

/** property を 1 つ変える GraphEvent (value が undefined なら消す) */
const propertyChanged = (node: GraphNode, name: string, value: unknown) =>
  propertiesChanged(node, { [name]: value });

/** 送るときに一緒に決めるもの (画面の「送る」の dialog の引数) */
export type SendOptions = {
  /** 宛先 (空 = 不特定)。無ければ今のまま */
  addressee?: readonly Did[];
  /** 答えを置く場所 (D7)。無ければ今のまま */
  answerTarget?: string;
};

/**
 * 送る (送り直す)。送った回数を 1 増やす (D12)。**閉じたものは送れない** — 開き直してから送る。
 * 二人が同時に送ると同じ回数になって一つに畳まれる (LWW) が、同じ依頼を二度出しても意味は同じである。
 *
 * 宛先・答えの置き場所を渡せば、**送った回数と同じ event に書く** (1 つの batch・1 回の undo)。
 * 分けると、宛先だけが届いて送った回数が届かない間がある
 */
export function sendRequest(
  node: GraphNode,
  options: SendOptions = {},
): GraphEvent {
  requireRequest(node);
  if (isClosed(node)) {
    throw new RequestActionError('閉じた依頼は送れない。開き直してから送る');
  }
  return propertiesChanged(node, {
    ...(options.addressee && {
      [ADDRESSEE_PROPERTY]: [...new Set(options.addressee)],
    }),
    ...(options.answerTarget !== undefined && {
      [ANSWER_TARGET_PROPERTY]: options.answerTarget,
    }),
    [SENT_PROPERTY]: sentCountOf(node) + 1,
  });
}

/** 閉じる */
export function closeRequest(node: GraphNode): GraphEvent {
  requireRequest(node);
  if (isClosed(node)) throw new RequestActionError('もう閉じている');
  return propertyChanged(node, CLOSED_PROPERTY, true);
}

/** 開き直す (閉じたのを戻す)。property を消す — `false` を書くより op-log が素直になる */
export function reopenRequest(node: GraphNode): GraphEvent {
  requireRequest(node);
  if (!isClosed(node)) throw new RequestActionError('閉じていない');
  return propertyChanged(node, CLOSED_PROPERTY, undefined);
}

/** 宛先を変える (空 = 不特定)。同じ DID は 1 つにする */
export function setAddressee(
  node: GraphNode,
  dids: readonly Did[],
): GraphEvent {
  requireRequest(node);
  return propertyChanged(node, ADDRESSEE_PROPERTY, [...new Set(dids)]);
}

/**
 * 答えを置く所: 依頼の右。既にこの依頼への答えがあれば、その一番下の下
 */
export function answerPlacement(
  sheet: Sheet,
  request: GraphNode,
): { x: number; y: number } {
  const layouts = new Map(sheet.layouts?.map((l) => [l.nodeId, l]));
  const at = layouts.get(request.id);
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' ? v : fallback;
  const x =
    num(at?.x, 0) + num(at?.width, DEFAULT_NODE_STYLE.width) + ANSWER_GAP_X;
  const answers = sheet.edges
    .filter((e) => e.source === request.id && answersOf(e) !== undefined)
    .map((e) => layouts.get(e.target))
    .filter((l): l is NodeLayout => typeof l?.y === 'number');
  if (answers.length === 0) return { x, y: num(at?.y, 0) };
  const bottom = Math.max(
    ...answers.map(
      (l) => (l.y as number) + num(l.height, DEFAULT_NODE_STYLE.height),
    ),
  );
  return { x, y: bottom + ANSWER_GAP_Y };
}

export type AnswerOptions = {
  content: string;
  /** 答えの edge の label (画面は利用者の言語の「答え」。無ければ付けない) */
  edgeLabel?: string;
  /** 置く所。無ければ `answerPlacement` */
  position?: { x: number; y: number };
};

/**
 * 答える (`answerTarget: linkedNode`, D7)。新しい node に答えを書き、依頼からその node へ edge を張り、
 * edge に**どの送信への答えか** (`answers` = 今の送った回数) を付ける。node と edge は 1 つの batch。
 *
 * 送っていない (下書き)・閉じた依頼には答えられない。**既に答えがあっても答えられる** — 答えの数は
 * 扱わない (D9)。答えた後に依頼が送り直されれば、この答えは前の送信へのものとして残る
 */
export function answerRequest(
  sheet: Sheet,
  request: GraphNode,
  options: AnswerOptions,
): { event: GraphEvent; nodeId: NodeId; edgeId: EdgeId } {
  requireRequest(request);
  const status = requestStatus(request, sheet.edges);
  if (status === 'draft') {
    throw new RequestActionError('まだ送られていない依頼には答えられない');
  }
  if (status === 'closed') {
    throw new RequestActionError('閉じた依頼には答えられない');
  }
  const nodeId = crypto.randomUUID() as NodeId;
  const edgeId = crypto.randomUUID() as EdgeId;
  const position = options.position ?? answerPlacement(sheet, request);
  const edge: GraphEdge = {
    id: edgeId,
    source: request.id,
    target: nodeId,
    ...(options.edgeLabel && { label: options.edgeLabel }),
    properties: { [ANSWERS_PROPERTY]: sentCountOf(request) },
  };
  return {
    nodeId,
    edgeId,
    event: {
      ...makeEventBase('structure'),
      type: 'NODES_PASTED',
      nodes: [{ id: nodeId, content: options.content }],
      layouts: [{ nodeId, ...position, ...DEFAULT_NODE_STYLE }],
      edges: [edge],
      edgeLayouts: [{ edgeId }],
    },
  };
}
