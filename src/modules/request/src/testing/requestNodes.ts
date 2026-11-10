/** 依頼の試験の道具: 応答を求める node を足す event (もとは headless の `testing/events.ts`) */

import type { GraphEvent } from '@conversensus/client/src/events/GraphEvent';
import type { GraphNode, NodeId } from '@conversensus/shared';
import { ADDRESSEE_PROPERTY } from '../requestNode';

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
