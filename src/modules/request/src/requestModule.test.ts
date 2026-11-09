import { describe, expect, test } from 'bun:test';
import { graphEventToOps } from '@conversensus/client/src/events/toUnified';
import type { NodeActionContext } from '@conversensus/client/src/nodeActions/nodeAction';
import { NodeActionError } from '@conversensus/client/src/nodeActions/nodeAction';
import {
  createNodeActionRegistry,
  runNodeAction,
} from '@conversensus/client/src/nodeActions/registry';
import type { Did, GraphEdge, GraphNode, Sheet } from '@conversensus/shared';
import fc from 'fast-check';
import { REQUEST_MODULE } from './requestModule';
import {
  ADDRESSEE_PROPERTY,
  ANSWER_TARGET_PROPERTY,
  ANSWERS_PROPERTY,
  CLOSED_PROPERTY,
  SENT_PROPERTY,
} from './requestNode';

const REQ = '11111111-1111-4111-8111-111111111111';
const ANSWER = '22222222-2222-4222-8222-222222222222';
const ALICE = 'did:plc:alice' as Did;
const AGENT = 'did:plc:agent' as Did;

const registry = createNodeActionRegistry([REQUEST_MODULE]);

/** 依頼の状態ごとの node と、答えの edge */
type Shape = { sent: number; closed: boolean; answeredLatest: boolean };

function ctxOf(
  { sent, closed, answeredLatest }: Shape,
  extra: Record<string, unknown> = {},
  locale: 'ja' | 'en' = 'ja',
): NodeActionContext {
  const node = {
    id: REQ,
    content: '要約して',
    properties: {
      [ADDRESSEE_PROPERTY]: [AGENT],
      ...(sent > 0 && { [SENT_PROPERTY]: sent }),
      ...(closed && { [CLOSED_PROPERTY]: true }),
      ...extra,
    },
  } as unknown as GraphNode;
  const edges: GraphEdge[] =
    answeredLatest && sent > 0
      ? [
          {
            id: '33333333-3333-4333-8333-333333333333',
            source: REQ,
            target: ANSWER,
            properties: { [ANSWERS_PROPERTY]: sent },
          } as unknown as GraphEdge,
        ]
      : [];
  const sheet = {
    id: '44444444-4444-4444-8444-444444444444',
    name: 's',
    nodes: [node, { id: ANSWER, content: '前の答え' }],
    edges,
    layouts: [],
  } as unknown as Sheet;
  return {
    node,
    sheet,
    me: ALICE,
    participants: [{ did: AGENT, label: 'agent' }],
    locale,
  };
}

const keys = (ctx: NodeActionContext) =>
  registry.actionsFor(ctx, { readOnly: false }).map((a) => a.key);

const DRAFT: Shape = { sent: 0, closed: false, answeredLatest: false };
const SENT: Shape = { sent: 1, closed: false, answeredLatest: false };
const ANSWERED: Shape = { sent: 1, closed: false, answeredLatest: true };
const CLOSED: Shape = { sent: 1, closed: true, answeredLatest: false };

describe('出る操作 (状態ごと)', () => {
  test('下書きは送るだけ。送った・回答ありは送り直す・答える・閉じる。閉じたは開き直すだけ', () => {
    expect(keys(ctxOf(DRAFT))).toEqual(['request/send']);
    const open = ['request/resend', 'request/answer', 'request/close'];
    expect(keys(ctxOf(SENT))).toEqual(open);
    expect(keys(ctxOf(ANSWERED))).toEqual(open);
    expect(keys(ctxOf(CLOSED))).toEqual(['request/reopen']);
  });

  test('応答を求める node でなければ何も出ない', () => {
    const ctx = ctxOf(DRAFT);
    const plain = { ...ctx, node: { id: REQ, content: 'ふつう' } as GraphNode };
    expect(keys(plain)).toEqual([]);
  });

  test('(性質) 出た操作はどれも実行でき、op にできる (押せるのに効かない形を作らない)', () => {
    fc.assert(
      fc.property(
        fc.record({
          sent: fc.nat({ max: 3 }),
          closed: fc.boolean(),
          answeredLatest: fc.boolean(),
        }),
        (shape) => {
          const ctx = ctxOf(shape);
          for (const found of registry.actionsFor(ctx, { readOnly: false })) {
            const args =
              found.action.id === 'answer'
                ? { content: '答え' }
                : (found.action.initial?.(ctx) ?? {});
            const event = runNodeAction(registry, found.key, ctx, args, {
              readOnly: false,
            });
            expect(graphEventToOps(event).length).toBeGreaterThan(0);
          }
        },
      ),
    );
  });
});

describe('送る', () => {
  test('送る・送り直すは undo で戻せない (相手に届く行為)。他の操作は戻せる', () => {
    const undoable = Object.fromEntries(
      REQUEST_MODULE.actions.map((a) => [a.id, a.undoable !== false]),
    );
    expect(undoable).toEqual({
      send: false,
      resend: false,
      answer: true,
      close: true,
      reopen: true,
    });
  });

  test('dialog の初めの値は今の宛先と答えの置き場所 (無ければ linkedNode)', () => {
    const send = registry.find('request/send');
    expect(send?.action.initial?.(ctxOf(DRAFT))).toEqual({
      addressee: [AGENT],
      answerTarget: 'linkedNode',
    });
  });

  test('宛先・答えの置き場所・送った回数を 1 つの event に書く', () => {
    const event = runNodeAction(
      registry,
      'request/send',
      ctxOf(DRAFT, { [ADDRESSEE_PROPERTY]: [] }),
      { addressee: [AGENT, ALICE], answerTarget: 'linkedNode' },
      { readOnly: false },
    );
    expect(event.type).toBe('NODE_PROPERTIES_CHANGED');
    if (event.type !== 'NODE_PROPERTIES_CHANGED') return;
    expect(event.to).toMatchObject({
      [ADDRESSEE_PROPERTY]: [AGENT, ALICE],
      [ANSWER_TARGET_PROPERTY]: 'linkedNode',
      [SENT_PROPERTY]: 1,
    });
  });

  test('答えの置き場所は選択肢にある値だけ (まだ扱わない newSheet は断る)', () => {
    expect(() =>
      runNodeAction(
        registry,
        'request/send',
        ctxOf(DRAFT),
        { addressee: [], answerTarget: 'newSheet' },
        { readOnly: false },
      ),
    ).toThrow(NodeActionError);
  });
});

describe('答える', () => {
  test('答えの edge の label は答える人の言語で書く', () => {
    for (const [locale, label] of [
      ['ja', '答え'],
      ['en', 'answer'],
    ] as const) {
      const event = runNodeAction(
        registry,
        'request/answer',
        ctxOf(SENT, {}, locale),
        { content: '答えです' },
        { readOnly: false },
      );
      if (event.type !== 'NODES_PASTED') throw new Error(event.type);
      expect(event.edges[0]?.label).toBe(label);
      expect(event.edges[0]?.properties?.[ANSWERS_PROPERTY]).toBe(1);
    }
  });

  test('空白だけの答えは断る', () => {
    expect(() =>
      runNodeAction(
        registry,
        'request/answer',
        ctxOf(SENT),
        { content: '  ' },
        { readOnly: false },
      ),
    ).toThrow(NodeActionError);
  });
});

describe('種', () => {
  test('「シートを追加 ▾」に依頼・相談の種を出す', () => {
    expect(registry.seeds.map((s) => String(s.template.id))).toEqual([
      'jp.co.metabolics.request',
    ]);
  });
});

describe('印', () => {
  const badgeOf = (shape: Shape) => {
    const ctx = ctxOf(shape);
    return registry.badgesFor({
      node: ctx.node,
      outgoing: () => ctx.sheet.edges,
    });
  };

  test('状態を値にし、送っていれば何回目かを添える', () => {
    expect(badgeOf(DRAFT)).toEqual([
      {
        moduleId: 'request',
        badge: {
          value: 'draft',
          tone: 'muted',
          text: { ja: '下書き', en: 'Draft' },
        },
      },
    ]);
    const answered = badgeOf({ ...ANSWERED, sent: 2 })[0]?.badge;
    expect(answered?.value).toBe('answered');
    expect(answered?.text.ja).toBe('回答あり · 2 回目');
  });

  test('応答を求める node でなければ印は無く、出ていく edge も数えない', () => {
    let counted = false;
    expect(
      registry.badgesFor({
        node: { id: REQ, content: 'ふつう' } as GraphNode,
        outgoing: () => {
          counted = true;
          return [];
        },
      }),
    ).toEqual([]);
    expect(counted).toBe(false);
  });
});
