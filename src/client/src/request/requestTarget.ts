/**
 * 画面と依頼の操作のつなぎ (agent 段 4 R4)
 *
 * React Flow の node・edge から、右の欄の「依頼」の区画が描く状態 (`RequestTarget`) を作り、
 * 区画のボタン (`RequestAction`) を GraphEvent にする (`requestEvents.ts`)。GraphEditor は
 * 選択と dispatch を持つだけで、判断はここと `requestEvents.ts` にある。
 */

import {
  addresseeOf,
  type Did,
  type GraphNode,
  type RequestStatus,
  requestStatus,
  type Sheet,
  sentCountOf,
} from '@conversensus/shared';
import type { Edge, Node } from '@xyflow/react';
import type { GraphEvent } from '../events/GraphEvent';
import { fromFlowEdges, fromFlowNodes } from '../graphTransform';
import {
  answerRequest,
  closeRequest,
  RequestActionError,
  reopenRequest,
  sendRequest,
  setAddressee,
} from './requestEvents';

/** 区画が描く、応答を求める node の今 */
export type RequestTarget = {
  status: RequestStatus;
  /** 送った回数 (0 = 下書き) */
  sent: number;
  /** 宛先 (空 = 不特定) */
  addressee: Did[];
};

/** 区画のボタン */
export type RequestAction =
  | { kind: 'send' }
  | { kind: 'close' }
  | { kind: 'reopen' }
  | { kind: 'setAddressee'; dids: readonly Did[] }
  | { kind: 'answer'; content: string };

/** ゴースト (消す予定の表示) は数えない — 状態の導出にも答えの置き場所にも */
const live = <T extends { data?: Record<string, unknown> }>(
  items: readonly T[],
) => items.filter((i) => i.data?.ghost !== true);

/** 今の canvas を Sheet の形にする (状態の導出と答えの置き場所に要る分) */
function sheetOf(nodes: readonly Node[], edges: readonly Edge[]): Sheet {
  const { nodes: graphNodes, layouts } = fromFlowNodes(live(nodes));
  const { edges: graphEdges } = fromFlowEdges(live(edges));
  return {
    id: '' as Sheet['id'],
    name: '',
    nodes: graphNodes,
    edges: graphEdges,
    layouts,
  };
}

/** 応答を求める node なら、その状態。違えば undefined */
export function requestTargetOf(
  node: Node,
  edges: readonly Edge[],
): RequestTarget | undefined {
  const [graphNode] = fromFlowNodes([node]).nodes;
  if (!graphNode) return undefined;
  const addressee = addresseeOf(graphNode);
  if (addressee === undefined) return undefined;
  return {
    status: requestStatus(graphNode, fromFlowEdges(live(edges)).edges),
    sent: sentCountOf(graphNode),
    addressee,
  };
}

/**
 * ボタンを GraphEvent にする。できない操作なら `RequestActionError` (区画はできないボタンを出さない)
 * @param answerEdgeLabel 答えの edge の label (利用者の言語の「答え」)
 */
export function requestEventFor(
  action: RequestAction,
  nodeId: string,
  nodes: readonly Node[],
  edges: readonly Edge[],
  answerEdgeLabel: string,
): GraphEvent {
  const sheet = sheetOf(nodes, edges);
  const node: GraphNode | undefined = sheet.nodes.find((n) => n.id === nodeId);
  if (!node) throw new RequestActionError(`node ${nodeId} が canvas に無い`);
  switch (action.kind) {
    case 'send':
      return sendRequest(node);
    case 'close':
      return closeRequest(node);
    case 'reopen':
      return reopenRequest(node);
    case 'setAddressee':
      return setAddressee(node, action.dids);
    case 'answer':
      return answerRequest(sheet, node, {
        content: action.content,
        edgeLabel: answerEdgeLabel,
      }).event;
  }
}
