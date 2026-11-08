import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import type { GraphEdge, GraphFile, GraphNode, Sheet } from '../schemas';
import {
  ADDRESSEE_PROPERTY,
  ANSWERS_PROPERTY,
  addresseeOf,
  answersOf,
  CLOSED_PROPERTY,
  isAddressedTo,
  isRequestNode,
  requestStatus,
  requestsInFile,
  SENT_PROPERTY,
  sentCountOf,
} from './request';
import { SHEET_KIND_PROPERTY, TEMPLATE_SHEET_KIND } from './sheetKind';

const REQ = '11111111-1111-4111-8111-111111111111';
const ANSWER = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const ALICE = 'did:plc:alice';
const AGENT = 'did:plc:agent';

const node = (properties?: Record<string, unknown>, id = REQ): GraphNode =>
  ({ id, content: '要約して', ...(properties && { properties }) }) as GraphNode;
const edge = (
  source: string,
  answers: unknown,
  id = crypto.randomUUID(),
): GraphEdge =>
  ({
    id,
    source,
    target: ANSWER,
    properties: { [ANSWERS_PROPERTY]: answers },
  }) as unknown as GraphEdge;
const request = (extra: Record<string, unknown> = {}) =>
  node({ [ADDRESSEE_PROPERTY]: [AGENT], ...extra });

describe('値の読み', () => {
  test('addressee を持つ node だけが応答を求める node。空の配列も (不特定)', () => {
    expect(isRequestNode(request())).toBe(true);
    expect(isRequestNode(node({ [ADDRESSEE_PROPERTY]: [] }))).toBe(true);
    expect(isRequestNode(node())).toBe(false);
    expect(isRequestNode(node({ [ADDRESSEE_PROPERTY]: AGENT }))).toBe(false);
  });

  test('宛先の配列のうち文字列でないものは落とす', () => {
    expect(
      addresseeOf(node({ [ADDRESSEE_PROPERTY]: [AGENT, 3, null] })),
    ).toEqual([AGENT]);
  });

  test('送った回数・答えの回数は 1 以上の整数だけを読む。他は無いのと同じ', () => {
    for (const bad of [0, -1, 1.5, '2', null, true]) {
      expect(sentCountOf(request({ [SENT_PROPERTY]: bad }))).toBe(0);
      expect(answersOf(edge(REQ, bad))).toBeUndefined();
    }
    expect(sentCountOf(request({ [SENT_PROPERTY]: 3 }))).toBe(3);
    expect(answersOf(edge(REQ, 2))).toBe(2);
  });
});

describe('状態 (D8)', () => {
  test('送っていなければ下書き', () => {
    expect(requestStatus(request(), [])).toBe('draft');
  });

  test('送って答えが無ければ送った・未回答', () => {
    expect(requestStatus(request({ [SENT_PROPERTY]: 1 }), [])).toBe('sent');
  });

  test('最後の送信への答えの edge があれば回答あり', () => {
    expect(requestStatus(request({ [SENT_PROPERTY]: 1 }), [edge(REQ, 1)])).toBe(
      'answered',
    );
  });

  test('送り直すと、前の送信への答えでは回答ありにならない', () => {
    expect(requestStatus(request({ [SENT_PROPERTY]: 2 }), [edge(REQ, 1)])).toBe(
      'sent',
    );
  });

  test('他の node から出た答えの edge は数えない', () => {
    expect(
      requestStatus(request({ [SENT_PROPERTY]: 1 }), [edge(OTHER, 1)]),
    ).toBe('sent');
  });

  test('閉じたは他より優先 (true のときだけ)', () => {
    expect(
      requestStatus(request({ [CLOSED_PROPERTY]: true, [SENT_PROPERTY]: 1 }), [
        edge(REQ, 1),
      ]),
    ).toBe('closed');
    expect(requestStatus(request({ [CLOSED_PROPERTY]: 'true' }), [])).toBe(
      'draft',
    );
  });

  // 性質の生成器: 値は小さなプールから引く。読めない値 (0・負・小数・文字列) を混ぜ、
  // 回数は 1〜3 に絞る — 広いと「答えの回数 = 送った回数」に当たらず、回答ありが試されない
  const count = fc.constantFrom<unknown>(undefined, 1, 2, 3, 0, -1, 1.5, '2');
  const closed = fc.constantFrom<unknown>(undefined, true, false, 'true');
  const arb = fc.record({
    sent: count,
    closed,
    edges: fc.array(
      fc.record({ source: fc.constantFrom(REQ, OTHER), answers: count }),
      { maxLength: 4 },
    ),
  });
  type Arb = {
    sent: unknown;
    closed: unknown;
    edges: { source: string; answers: unknown }[];
  };
  const build = ({ sent, closed: c, edges }: Arb) => ({
    node: request({ [SENT_PROPERTY]: sent, [CLOSED_PROPERTY]: c }),
    edges: edges.map((e) => edge(e.source, e.answers)),
  });

  test('性質: 閉じた node はどんな送信・答えでも「閉じた」', () => {
    fc.assert(
      fc.property(arb, (a) => {
        const { node: n, edges } = build({ ...a, closed: true });
        expect(requestStatus(n, edges)).toBe('closed');
      }),
    );
  });

  test('性質: 「回答あり」⇔ 閉じておらず、この node から最後の送信への答えの edge がある', () => {
    fc.assert(
      fc.property(arb, (a) => {
        const { node: n, edges } = build(a);
        const sent = sentCountOf(n);
        const expected =
          a.closed !== true &&
          sent >= 1 &&
          edges.some((e) => e.source === REQ && answersOf(e) === sent);
        expect(requestStatus(n, edges) === 'answered').toBe(expected);
      }),
    );
  });

  test('性質: 送り直すと (新しい答えが来るまで)「回答あり」ではなくなる', () => {
    fc.assert(
      fc.property(arb, (a) => {
        const { node: n, edges } = build({ ...a, closed: undefined });
        const resent = request({ [SENT_PROPERTY]: sentCountOf(n) + 1 });
        expect(requestStatus(resent, edges)).toBe(
          // 送り直した回数への答えが既にある (生成器が先回りで引いた) ときだけ回答あり
          edges.some(
            (e) => e.source === REQ && answersOf(e) === sentCountOf(resent),
          )
            ? 'answered'
            : 'sent',
        );
      }),
    );
  });
});

describe('宛先', () => {
  test('宛先に入っていれば宛てたもの。空 (不特定) なら誰にでも', () => {
    expect(isAddressedTo(request(), AGENT)).toBe(true);
    expect(isAddressedTo(request(), ALICE)).toBe(false);
    expect(isAddressedTo(node({ [ADDRESSEE_PROPERTY]: [] }), ALICE)).toBe(true);
    expect(isAddressedTo(node(), ALICE)).toBe(false);
  });
});

describe('requestsInFile', () => {
  const sheet = (
    nodes: GraphNode[],
    properties?: Record<string, unknown>,
  ): Sheet =>
    ({
      id: crypto.randomUUID(),
      name: 's',
      nodes,
      edges: [],
      ...(properties && { properties }),
    }) as unknown as Sheet;

  test('応答を求める node を状態つきで並べる。template graph の sheet は除く', () => {
    const plain = sheet([
      request({ [SENT_PROPERTY]: 1 }),
      node(undefined, OTHER),
    ]);
    const template = sheet([request()], {
      [SHEET_KIND_PROPERTY]: TEMPLATE_SHEET_KIND,
    });
    const file = {
      id: crypto.randomUUID(),
      name: 'f',
      sheets: [template, plain],
    } as GraphFile;
    const found = requestsInFile(file);
    expect(
      found.map((r): string[] => [r.sheet.id, r.node.id, r.status]),
    ).toEqual([[plain.id, REQ, 'sent']]);
  });
});
