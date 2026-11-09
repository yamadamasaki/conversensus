/**
 * 応答を求める node (agent 段 4 R1, 設計 agent-actor.md D6・D8)
 *
 * 依頼・相談の**種類**は template が決める (D6)。種類に依らない「応答を求める node」は、依頼の module の
 * 名前空間 (`app.conversensus.request.`) のシステム・プロパティ 4 つで表される。このファイルは依頼の
 * module へ移す予定である (計画 node-actions-request-module.md N3):
 *
 * | property | 付く所 | 値 | 意味 |
 * | --- | --- | --- | --- |
 * | `app.conversensus.request.addressee` | node | DID の配列 (空 = 不特定) | 応答を求めている相手。**これを持つことが印** |
 * | `app.conversensus.request.sent` | node | 整数 (送った回数) | 送った (D12) |
 * | `app.conversensus.request.closed` | node | boolean | 閉じた |
 * | `app.conversensus.request.answers` | edge | 整数 (どの送信への答えか) | この edge は答えへのつながり |
 *
 * **状態は保存せず導出する** (D8)。「送った」「閉じた」は依頼した人の行為なので op に残り、
 * 「回答あり」は答えの edge から導く。
 *
 * 値は op-log から来るので、**形が違っても落ちない**。読めない値は「無い」と同じに扱う
 * (知らない op を読み飛ばすのと同じ構え、step3 FPR 基準 5)。
 */

import {
  type Did,
  type GraphEdge,
  type GraphFile,
  type GraphNode,
  type Sheet,
  SYSTEM_PROPERTY_PREFIX,
  sheetKindOf,
  TEMPLATE_SHEET_KIND,
} from '@conversensus/shared';

/**
 * 依頼の module の名前空間。本体に同梱する module なので system の名前 (`app.conversensus.`) の下に置く
 * (property の欄・検索・`set_property` からは見えず変えられない — 変えるのは依頼の操作だけ)
 */
export const REQUEST_PROPERTY_PREFIX = `${SYSTEM_PROPERTY_PREFIX}request.`;
/** 応答を求めている相手 (DID の配列。空 = 不特定)。これを持つ node が「応答を求める node」 */
export const ADDRESSEE_PROPERTY = `${REQUEST_PROPERTY_PREFIX}addressee`;
/** 送った回数 */
export const SENT_PROPERTY = `${REQUEST_PROPERTY_PREFIX}sent`;
/** 閉じたか */
export const CLOSED_PROPERTY = `${REQUEST_PROPERTY_PREFIX}closed`;
/** (edge) どの送信への答えか */
export const ANSWERS_PROPERTY = `${REQUEST_PROPERTY_PREFIX}answers`;

/**
 * 答えを置く場所 (D7)。template のふつうの property (名前に `.` を含まない)。
 * conversensus は読まず、強制もしない — 答える側への注文である
 */
export const ANSWER_TARGET_PROPERTY = 'answerTarget';
/** 答えを新しい node に書き、依頼から edge を張る (既定。段 4 はこれだけ — 計画 Q1) */
export const ANSWER_TARGET_LINKED_NODE = 'linkedNode';

/** 応答を求める node の状態 (D8) */
export type RequestStatus = 'draft' | 'sent' | 'answered' | 'closed';

type WithProperties = { properties?: Record<string, unknown> };

/** 送った回数・答えの回数として読める値: 1 以上の整数 */
const isCount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1;

/**
 * 宛先。**応答を求める node でなければ undefined**。配列のうち文字列でない要素は落とす
 */
export function addresseeOf(element: WithProperties): Did[] | undefined {
  const value = element.properties?.[ADDRESSEE_PROPERTY];
  if (!Array.isArray(value)) return undefined;
  return value.filter((v): v is Did => typeof v === 'string');
}

/** 応答を求める node か */
export function isRequestNode(node: WithProperties): boolean {
  return addresseeOf(node) !== undefined;
}

/** 送った回数。送っていなければ 0 */
export function sentCountOf(node: WithProperties): number {
  const value = node.properties?.[SENT_PROPERTY];
  return isCount(value) ? value : 0;
}

/** 閉じたか (`true` のときだけ。他の値は閉じていない) */
export function isClosed(node: WithProperties): boolean {
  return node.properties?.[CLOSED_PROPERTY] === true;
}

/** (edge) どの送信への答えか。答えの edge でなければ undefined */
export function answersOf(edge: WithProperties): number | undefined {
  const value = edge.properties?.[ANSWERS_PROPERTY];
  return isCount(value) ? value : undefined;
}

/**
 * 状態を導出する (D8):
 *
 * - 閉じた: `closed` が true (**他より優先**)
 * - 下書き: 送っていない
 * - 回答あり: 依頼から出る edge のうち、**最後の送信への答え** (`answers` = `sent`) がある
 * - 送った・未回答: それ以外。**送り直すと、前の送信への答えでは「回答あり」にならない** —
 *   本文を直して送り直したのは、新しい答えが欲しいからである (D12)
 */
export function requestStatus(
  node: GraphNode,
  edges: readonly GraphEdge[],
): RequestStatus {
  const sent = sentCountOf(node);
  return statusOf(
    node,
    edges.some((e) => e.source === node.id && answersOf(e) === sent),
  );
}

/**
 * 状態の規則そのもの。**最後の送信への答えがあるか**は呼ぶ側が数える (`requestStatus` は edge の配列から、
 * 画面の node の印は React Flow の edge の store から)
 */
export function statusOf(
  node: WithProperties,
  answeredLatest: boolean,
): RequestStatus {
  if (isClosed(node)) return 'closed';
  if (sentCountOf(node) === 0) return 'draft';
  return answeredLatest ? 'answered' : 'sent';
}

/**
 * その DID に宛てたものか。**宛先が空 (不特定) なら参加者全員に宛てている** (D11)。
 * 応答を求める node でなければ false
 */
export function isAddressedTo(node: WithProperties, did: Did): boolean {
  const addressee = addresseeOf(node);
  if (addressee === undefined) return false;
  return addressee.length === 0 || addressee.includes(did);
}

/** File の中の応答を求める node 1 つ */
export type RequestEntry = {
  sheet: Sheet;
  node: GraphNode;
  status: RequestStatus;
};

/**
 * Sheet の中の応答を求める node。**template graph の sheet は除く** — 依頼の種類の node は、種類の
 * 既定値として `addressee` を持つ (計画 F3) が、それは型の定義であって依頼ではない
 */
export function requestsInSheet(sheet: Sheet): RequestEntry[] {
  if (sheetKindOf(sheet) === TEMPLATE_SHEET_KIND) return [];
  return sheet.nodes
    .filter(isRequestNode)
    .map((node) => ({ sheet, node, status: requestStatus(node, sheet.edges) }));
}

/** File の中の応答を求める node (Sheet の順、Sheet の中は node の順) */
export function requestsInFile(file: GraphFile): RequestEntry[] {
  return file.sheets.flatMap(requestsInSheet);
}
