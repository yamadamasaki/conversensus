/**
 * テストで書く GraphEvent を組む (agent 段 2 H3)。UI が dispatch するのと同じ形にする
 */

import type { GraphEvent } from '@conversensus/client/src/events/GraphEvent';
import {
  ADDRESSEE_PROPERTY,
  type GraphNode,
  type NodeId,
} from '@conversensus/shared';

/** 新しい node を足す event と、その node の id */
export function nodeAdded(content: string): {
  nodeId: NodeId;
  event: GraphEvent;
} {
  const nodeId = crypto.randomUUID() as NodeId;
  return {
    nodeId,
    event: {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      category: 'structure',
      type: 'NODE_ADDED',
      nodeId,
      data: { id: nodeId, content },
    },
  };
}

/** node の本文を書き換える event */
export function contentChanged(
  nodeId: NodeId,
  from: string,
  to: string,
): GraphEvent {
  return {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    category: 'content',
    type: 'NODE_CONTENT_CHANGED',
    nodeId,
    from,
    to,
  };
}

/**
 * 応答を求める node を足す event (agent 段 4)。template の種類で作ったのと同じく、宛先を持たせる
 * (種別プロパティは持たない — 状態と通知は種類に依らない)
 */
export function requestAdded(
  content: string,
  addressee: readonly string[],
): { nodeId: NodeId; node: GraphNode; event: GraphEvent } {
  const nodeId = crypto.randomUUID() as NodeId;
  const node: GraphNode = {
    id: nodeId,
    content,
    properties: { [ADDRESSEE_PROPERTY]: [...addressee] },
  };
  return {
    nodeId,
    node,
    event: {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      category: 'structure',
      type: 'NODE_ADDED',
      nodeId,
      data: node,
    },
  };
}
