import { describe, expect, test } from 'bun:test';
import {
  ADDRESSEE_PROPERTY,
  ANSWERS_PROPERTY,
  SENT_PROPERTY,
} from '@conversensus/shared';
import type { Edge, Node } from '@xyflow/react';
import { graphEventToOps } from '../events/toUnified';
import { RequestActionError } from './requestEvents';
import { requestEventFor, requestTargetOf } from './requestTarget';

const REQ = '11111111-1111-4111-8111-111111111111';
const ANSWER = '22222222-2222-4222-8222-222222222222';
const AGENT = 'did:plc:agent';

const flowNode = (id: string, properties?: Record<string, unknown>): Node => ({
  id,
  position: { x: 0, y: 0 },
  data: { content: 'x', ...(properties && { properties }) },
});
const answerEdge = (answers: number, ghost = false): Edge => ({
  id: crypto.randomUUID(),
  source: REQ,
  target: ANSWER,
  data: {
    properties: { [ANSWERS_PROPERTY]: answers },
    ...(ghost && { ghost: true }),
  },
});
const request = (sent: number) =>
  flowNode(REQ, { [ADDRESSEE_PROPERTY]: [AGENT], [SENT_PROPERTY]: sent });

describe('requestTargetOf', () => {
  test('応答を求める node なら状態・送った回数・宛先を返し、違えば undefined', () => {
    expect(requestTargetOf(request(1), [answerEdge(1)])).toEqual({
      status: 'answered',
      sent: 1,
      addressee: [AGENT],
    });
    expect(requestTargetOf(flowNode(ANSWER), [])).toBeUndefined();
  });

  test('ゴースト (消す予定の表示) の答えの edge は数えない', () => {
    expect(requestTargetOf(request(1), [answerEdge(1, true)])?.status).toBe(
      'sent',
    );
  });
});

describe('requestEventFor', () => {
  test('ボタンを GraphEvent にする (答えは利用者の言語の label を付ける)', () => {
    const nodes = [request(1), flowNode(ANSWER)];
    expect(
      graphEventToOps(
        requestEventFor({ kind: 'send' }, REQ, nodes, [], '答え'),
      ),
    ).toEqual([
      {
        kind: 'node.setProperty',
        target: REQ as never,
        name: SENT_PROPERTY,
        value: 2,
      },
    ]);
    const answer = graphEventToOps(
      requestEventFor(
        { kind: 'answer', content: '要約' },
        REQ,
        nodes,
        [],
        '答え',
      ),
    );
    expect(answer[2]).toMatchObject({
      kind: 'edge.add',
      label: '答え',
      source: REQ,
    });
  });

  test('canvas に無い node には何もできない', () => {
    expect(() =>
      requestEventFor({ kind: 'send' }, ANSWER, [request(1)], [], '答え'),
    ).toThrow(RequestActionError);
  });
});
