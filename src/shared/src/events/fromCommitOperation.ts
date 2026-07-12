/**
 * CommitOperation → 統一イベント (Op[]) のエンコーダ
 *
 * 既存の同期語彙 `CommitOperation` (6 種) が統一語彙の部分集合であることを示す。
 * 1 つの `node.update` / `edge.update` は複数の Op (setContent + setProperties + setParent)
 * に展開されうる。
 */

import type { CommitOperation, EdgeId, NodeId } from '../schemas';
import {
  type Actor,
  type Batch,
  type BatchId,
  BatchIdSchema,
  type Lamport,
  type Op,
} from './unified';

export function commitOperationToOps(op: CommitOperation): Op[] {
  switch (op.op) {
    case 'node.add':
      return [
        {
          kind: 'node.add',
          target: op.nodeId as NodeId,
          content: op.content,
          ...(op.properties && { properties: op.properties }),
          ...(op.nodeType && { nodeType: op.nodeType }),
          ...(op.parentId !== undefined && {
            parentId: op.parentId as NodeId,
          }),
        },
      ];
    case 'node.update': {
      const ops: Op[] = [];
      if (op.content !== undefined)
        ops.push({
          kind: 'node.setContent',
          target: op.nodeId as NodeId,
          content: op.content,
        });
      if (op.properties !== undefined)
        ops.push({
          kind: 'node.setProperties',
          target: op.nodeId as NodeId,
          properties: op.properties,
        });
      if (op.parentId !== undefined)
        ops.push({
          kind: 'node.setParent',
          target: op.nodeId as NodeId,
          parentId: op.parentId as NodeId,
        });
      return ops;
    }
    case 'node.remove':
      return [{ kind: 'node.remove', target: op.nodeId as NodeId }];
    case 'edge.add':
      return [
        {
          kind: 'edge.add',
          target: op.edgeId as EdgeId,
          source: op.sourceId as NodeId,
          dest: op.targetId as NodeId,
          ...(op.label !== undefined && { label: op.label }),
          ...(op.properties && { properties: op.properties }),
        },
      ];
    case 'edge.update': {
      const ops: Op[] = [];
      if (op.label !== undefined)
        ops.push({
          kind: 'edge.setLabel',
          target: op.edgeId as EdgeId,
          label: op.label,
        });
      if (op.properties !== undefined)
        ops.push({
          kind: 'edge.setProperties',
          target: op.edgeId as EdgeId,
          properties: op.properties,
        });
      return ops;
    }
    case 'edge.remove':
      return [{ kind: 'edge.remove', target: op.edgeId as EdgeId }];
  }
}

/** CommitOperation[] を 1 つの Batch にまとめる (1 コミット = 1 バッチ相当) */
export function commitOperationsToBatch(
  ops: CommitOperation[],
  meta: { id?: BatchId; actor: Actor; clock: Lamport; timestamp: number },
): Batch {
  return {
    id: meta.id ?? (BatchIdSchema.parse(crypto.randomUUID()) as BatchId),
    actor: meta.actor,
    clock: meta.clock,
    timestamp: meta.timestamp,
    ops: ops.flatMap(commitOperationToOps),
  };
}
