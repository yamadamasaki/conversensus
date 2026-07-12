import { describe, expect, test } from 'bun:test';
import type { CommitOperation } from '../schemas';
import {
  commitOperationsToBatch,
  commitOperationToOps,
} from './fromCommitOperation';
import { projectBatches } from './project';

const uuid = () => crypto.randomUUID();

describe('commitOperationToOps', () => {
  test('node.update は content / properties / parentId を最大3つの op に展開する', () => {
    const nodeId = uuid();
    const parentId = uuid();
    const op: CommitOperation = {
      op: 'node.update',
      nodeId,
      content: 'X',
      properties: { color: 'red' },
      parentId,
    };
    const ops = commitOperationToOps(op);
    expect(ops.map((o) => o.kind)).toEqual([
      'node.setContent',
      'node.setProperties',
      'node.setParent',
    ]);
  });

  test('edge.remove は edge.remove op へ写像する', () => {
    const edgeId = uuid();
    expect(commitOperationToOps({ op: 'edge.remove', edgeId })).toEqual([
      { kind: 'edge.remove', target: edgeId },
    ]);
  });
});

describe('commitOperationsToBatch → projectBatches', () => {
  test('CommitOperation 列がグラフ状態を正しく導出する (同期語彙の部分集合性)', () => {
    const a = uuid();
    const b = uuid();
    const e = uuid();
    const ops: CommitOperation[] = [
      { op: 'node.add', nodeId: a, content: 'A' },
      { op: 'node.add', nodeId: b, content: 'B' },
      { op: 'edge.add', edgeId: e, sourceId: a, targetId: b, label: 'rel' },
      { op: 'node.update', nodeId: a, content: 'A2' },
    ];
    const batch = commitOperationsToBatch(ops, {
      actor: 'did:example:alice',
      clock: 1,
      timestamp: Date.now(),
    });
    const g = projectBatches([batch]);
    expect(g.nodes.get(a as never)?.content).toBe('A2');
    expect(g.edges.get(e as never)?.label).toBe('rel');
  });
});
