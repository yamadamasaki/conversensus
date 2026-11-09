import { describe, expect, test } from 'bun:test';
import type { GraphEvent } from '@conversensus/client/src/events/GraphEvent';
import { graphEventToOps } from '@conversensus/client/src/events/toUnified';
import {
  ADDRESSEE_PROPERTY,
  ANSWERS_PROPERTY,
  CLOSED_PROPERTY,
  type GraphNode,
  requestStatus,
  SENT_PROPERTY,
  type Sheet,
} from '@conversensus/shared';
import fc from 'fast-check';
import {
  answerPlacement,
  answerRequest,
  closeRequest,
  RequestActionError,
  reopenRequest,
  sendRequest,
  setAddressee,
} from './requestEvents';

const REQ = '11111111-1111-4111-8111-111111111111';
const PLAIN = '22222222-2222-4222-8222-222222222222';
const AGENT = 'did:plc:agent';
const ALICE = 'did:plc:alice';

const requestNode = (extra: Record<string, unknown> = {}): GraphNode =>
  ({
    id: REQ,
    content: '要約して',
    properties: {
      [ADDRESSEE_PROPERTY]: [AGENT],
      answerTarget: 'linkedNode',
      ...extra,
    },
  }) as unknown as GraphNode;

const sheetWith = (node: GraphNode): Sheet =>
  ({
    id: '33333333-3333-4333-8333-333333333333',
    name: 's',
    nodes: [node, { id: PLAIN, content: 'ふつう' }],
    edges: [],
    layouts: [{ nodeId: REQ, x: 100, y: 50, width: 160, height: 80 }],
  }) as unknown as Sheet;

/**
 * 依頼の GraphEvent を Sheet に畳む (テスト用。property の変更と、node・edge を足すことだけ)。
 * 状態の導出 (`requestStatus`) に効くのはこの 2 つだけである
 */
function fold(sheet: Sheet, event: GraphEvent): Sheet {
  if (event.type === 'NODE_PROPERTIES_CHANGED') {
    return {
      ...sheet,
      nodes: sheet.nodes.map((n) =>
        n.id === event.nodeId ? { ...n, properties: event.to } : n,
      ),
    };
  }
  if (event.type === 'NODES_PASTED') {
    return {
      ...sheet,
      nodes: [...sheet.nodes, ...event.nodes],
      edges: [...sheet.edges, ...event.edges],
      layouts: [...(sheet.layouts ?? []), ...event.layouts],
    };
  }
  throw new Error(`畳めない: ${event.type}`);
}
const reqOf = (sheet: Sheet) =>
  sheet.nodes.find((n) => n.id === REQ) as GraphNode;
const statusOf = (sheet: Sheet) => requestStatus(reqOf(sheet), sheet.edges);

describe('操作 → op', () => {
  test('送ると sent が 1 増える (node.setProperty 1 つ)', () => {
    expect(
      graphEventToOps(sendRequest(requestNode({ [SENT_PROPERTY]: 2 }))),
    ).toEqual([
      {
        kind: 'node.setProperty',
        target: REQ as never,
        name: SENT_PROPERTY,
        value: 3,
      },
    ]);
  });

  test('宛先・答えの置き場所を渡して送ると、送った回数と同じ 1 つの event に書く (宛先の重なりは 1 つに)', () => {
    const ops = graphEventToOps(
      sendRequest(requestNode({ [SENT_PROPERTY]: 1 }), {
        addressee: [ALICE, AGENT, ALICE],
        answerTarget: 'linkedNode',
      }),
    );
    expect(ops).toHaveLength(2);
    expect(ops).toContainEqual({
      kind: 'node.setProperty',
      target: REQ as never,
      name: ADDRESSEE_PROPERTY,
      value: [ALICE, AGENT],
    });
    expect(ops).toContainEqual({
      kind: 'node.setProperty',
      target: REQ as never,
      name: SENT_PROPERTY,
      value: 2,
    });
  });

  test('閉じると closed = true、開き直すと closed を消す', () => {
    expect(graphEventToOps(closeRequest(requestNode()))).toEqual([
      {
        kind: 'node.setProperty',
        target: REQ as never,
        name: CLOSED_PROPERTY,
        value: true,
      },
    ]);
    expect(
      graphEventToOps(reopenRequest(requestNode({ [CLOSED_PROPERTY]: true }))),
    ).toEqual([
      { kind: 'node.setProperty', target: REQ as never, name: CLOSED_PROPERTY },
    ]);
  });

  test('宛先を変える (重なりは 1 つにする)', () => {
    expect(
      graphEventToOps(setAddressee(requestNode(), [ALICE, AGENT, ALICE])),
    ).toEqual([
      {
        kind: 'node.setProperty',
        target: REQ as never,
        name: ADDRESSEE_PROPERTY,
        value: [ALICE, AGENT],
      },
    ]);
  });

  test('答えるは node と edge を 1 つの batch で書き、edge に answers (今の送った回数) を付ける', () => {
    const sheet = sheetWith(requestNode({ [SENT_PROPERTY]: 2 }));
    const { event, nodeId, edgeId } = answerRequest(sheet, reqOf(sheet), {
      content: '要約です',
      edgeLabel: '答え',
    });
    const ops = graphEventToOps(event);
    expect(ops.map((op) => op.kind)).toEqual([
      'node.add',
      'node.setLayout',
      'edge.add',
    ]);
    expect(ops[0]).toMatchObject({ target: nodeId, content: '要約です' });
    expect(ops[2]).toMatchObject({
      target: edgeId,
      source: REQ,
      dest: nodeId,
      label: '答え',
      properties: { [ANSWERS_PROPERTY]: 2 },
    });
  });
});

describe('できないこと', () => {
  test('応答を求める node でなければ、どの操作もできない', () => {
    const plain = { id: PLAIN, content: 'x' } as unknown as GraphNode;
    for (const act of [sendRequest, closeRequest, reopenRequest]) {
      expect(() => act(plain)).toThrow(RequestActionError);
    }
  });

  test('閉じた依頼は送れず、答えられない。下書きには答えられない', () => {
    const closed = requestNode({ [CLOSED_PROPERTY]: true, [SENT_PROPERTY]: 1 });
    expect(() => sendRequest(closed)).toThrow(/開き直して/);
    expect(() =>
      answerRequest(sheetWith(closed), closed, { content: 'x' }),
    ).toThrow(/閉じた/);
    const draft = requestNode();
    expect(() =>
      answerRequest(sheetWith(draft), draft, { content: 'x' }),
    ).toThrow(/送られていない/);
  });

  test('閉じたものは閉じられず、閉じていないものは開き直せない', () => {
    expect(() =>
      closeRequest(requestNode({ [CLOSED_PROPERTY]: true })),
    ).toThrow(RequestActionError);
    expect(() => reopenRequest(requestNode())).toThrow(RequestActionError);
  });
});

describe('答えを置く所', () => {
  test('最初の答えは依頼の右、次の答えはその下', () => {
    let sheet = sheetWith(requestNode({ [SENT_PROPERTY]: 1 }));
    expect(answerPlacement(sheet, reqOf(sheet))).toEqual({
      x: 100 + 160 + 80,
      y: 50,
    });
    sheet = fold(
      sheet,
      answerRequest(sheet, reqOf(sheet), { content: 'a' }).event,
    );
    expect(answerPlacement(sheet, reqOf(sheet))).toEqual({
      x: 340,
      y: 50 + 80 + 40,
    });
  });
});

describe('操作の列と状態 (性質)', () => {
  // 操作の列を引き、できる操作だけを順に行う。できない操作 (RequestActionError) は飛ばす —
  // 画面がボタンを出さないのと同じ
  const action = fc.constantFrom('send', 'answer', 'close', 'reopen');

  test('性質: どの時点でも、状態は「最後にした意味のある操作」と合う', () => {
    fc.assert(
      fc.property(fc.array(action, { maxLength: 12 }), (actions) => {
        let sheet = sheetWith(requestNode());
        let beforeClose = statusOf(sheet);
        for (const a of actions) {
          const req = reqOf(sheet);
          let event: GraphEvent;
          try {
            event =
              a === 'send'
                ? sendRequest(req)
                : a === 'close'
                  ? closeRequest(req)
                  : a === 'reopen'
                    ? reopenRequest(req)
                    : answerRequest(sheet, req, { content: '答え' }).event;
          } catch (error) {
            if (error instanceof RequestActionError) continue;
            throw error;
          }
          if (a === 'close') beforeClose = statusOf(sheet);
          sheet = fold(sheet, event);
          const status = statusOf(sheet);
          // 閉じたら閉じた。送ったら (前に答えがあっても) 未回答。答えたら回答あり
          if (a === 'close') expect(status).toBe('closed');
          if (a === 'send') expect(status).toBe('sent');
          if (a === 'answer') expect(status).toBe('answered');
          // 開き直すと、閉じる前の状態に戻る (下書き・未回答・回答あり のどれか)
          if (a === 'reopen') expect(status).toBe(beforeClose);
        }
      }),
    );
  });
});
