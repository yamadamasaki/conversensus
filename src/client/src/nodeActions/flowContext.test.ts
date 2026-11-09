import { describe, expect, test } from 'bun:test';
import type { Did } from '@conversensus/shared';
import type { Edge, Node } from '@xyflow/react';
import { actionContextOf, sheetOfFlow } from './flowContext';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const GHOST = '33333333-3333-4333-8333-333333333333';
const ME = 'did:plc:me' as Did;

const flowNode = (id: string, extra: Record<string, unknown> = {}): Node => ({
  id,
  position: { x: 0, y: 0 },
  data: { content: id, ...extra },
});
const flowEdge = (id: string, ghost = false): Edge => ({
  id,
  source: A,
  target: B,
  data: ghost ? { ghost: true } : {},
});

const nodes = [flowNode(A), flowNode(B), flowNode(GHOST, { ghost: true })];
const edges = [
  flowEdge('44444444-4444-4444-8444-444444444444'),
  flowEdge('55555555-5555-4555-8555-555555555555', true),
];
const env = {
  me: ME,
  participants: [{ did: ME, label: 'me' }],
  locale: 'ja' as const,
};

describe('flowContext', () => {
  test('Sheet の形にするとき、ゴーストの node と edge は数えない', () => {
    const sheet = sheetOfFlow(nodes, edges);
    expect(sheet.nodes.map((n) => n.id as string)).toEqual([A, B]);
    expect(sheet.edges).toHaveLength(1);
  });

  test('文脈は対象の node・Sheet・操作する人・参加者を持つ', () => {
    const ctx = actionContextOf(A, nodes, edges, env);
    expect(ctx?.node.id as string | undefined).toBe(A);
    expect(ctx?.sheet.nodes).toHaveLength(2);
    expect(ctx?.me).toBe(ME);
    expect(ctx?.participants).toEqual(env.participants);
  });

  test('無い node・ゴーストの node には文脈が無い (操作の対象にしない)', () => {
    expect(actionContextOf(GHOST, nodes, edges, env)).toBeUndefined();
    expect(
      actionContextOf(
        '66666666-6666-4666-8666-666666666666',
        nodes,
        edges,
        env,
      ),
    ).toBeUndefined();
  });
});
