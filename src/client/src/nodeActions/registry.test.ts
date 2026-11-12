import { describe, expect, mock, test } from 'bun:test';
import type { Did, GraphNode } from '@conversensus/shared';
import fc from 'fast-check';
import type { GraphEvent } from '../events/GraphEvent';
import type {
  ActionParam,
  LocalizedText,
  NodeAction,
  NodeActionContext,
  NodeModule,
} from './nodeAction';
import { NodeActionError } from './nodeAction';
import {
  actionKey,
  createNodeActionRegistry,
  normalizeInitialArgs,
  noticeKeyOf,
  runNodeAction,
  validateArgs,
} from './registry';

const NODE = '11111111-1111-4111-8111-111111111111';
const ALICE = 'did:plc:alice' as Did;
const BOB = 'did:plc:bob' as Did;

/** run が返す event (中身は見ない。同じものが返ることだけを見る) */
const DUMMY_EVENT = { type: 'NODE_PROPERTIES_CHANGED' } as GraphEvent;

const text = (s: string): LocalizedText => ({ ja: s, en: s });

/** node の本文が token を含めば使える操作 (使えるかを本文だけで決め、生成器で引けるようにする) */
const TOKENS = ['a', 'b', 'c', 'd'] as const;

const ctxWith = (content: string): NodeActionContext => ({
  node: { id: NODE, content } as GraphNode,
  sheet: { id: '', name: '', nodes: [], edges: [], layouts: [] } as never,
  me: ALICE,
  participants: [],
  locale: 'ja',
});

const tokenAction = (
  id: string,
  token: string,
  run: NodeAction['run'] = () => DUMMY_EVENT,
): NodeAction => ({
  id,
  label: text(id),
  available: (ctx) => ctx.node.content.includes(token),
  run,
});

/** module の並び: module ごとに 0〜3 個の操作、それぞれ token を 1 つ持つ。id は位置から振る (重ならない) */
const modulesArb = fc
  .array(fc.array(fc.constantFrom(...TOKENS), { maxLength: 3 }), {
    minLength: 1,
    maxLength: 3,
  })
  .map((shape) =>
    shape.map(
      (tokens, i): NodeModule => ({
        id: `m${i}`,
        actions: tokens.map((t, j) => tokenAction(`act${j}-${t}`, t)),
      }),
    ),
  );
/** node の本文: token の部分集合 */
const contentArb = fc.subarray([...TOKENS]).map((ts) => ts.join(' '));

/** 登録の順に、使えるはずの鍵 (仕様をそのまま書いたもの) */
const expectedKeys = (modules: readonly NodeModule[], content: string) =>
  modules.flatMap((m) =>
    m.actions
      .filter((a) => a.available(ctxWith(content)))
      .map((a) => actionKey(m.id, a.id)),
  );

describe('使える操作 (性質)', () => {
  test('見るだけの所では、どの node にも何も出ない', () => {
    fc.assert(
      fc.property(modulesArb, contentArb, (modules, content) => {
        const registry = createNodeActionRegistry(modules);
        expect(
          registry.actionsFor(ctxWith(content), { readOnly: true }),
        ).toEqual([]);
      }),
    );
  });

  test('出るのは、使える操作ちょうど (登録の順)。使えない操作は出ない', () => {
    fc.assert(
      fc.property(modulesArb, contentArb, (modules, content) => {
        const registry = createNodeActionRegistry(modules);
        const keys = registry
          .actionsFor(ctxWith(content), { readOnly: false })
          .map((a) => a.key);
        expect(keys).toEqual(expectedKeys(modules, content));
      }),
    );
  });

  test('実行は、使える操作のときだけ run に届く。それ以外は NodeActionError で run を呼ばない', () => {
    fc.assert(
      fc.property(
        modulesArb,
        contentArb,
        fc.boolean(),
        fc.nat(),
        (shape, content, readOnly, pick) => {
          const run = mock(() => DUMMY_EVENT);
          const modules = shape.map((m) => ({
            ...m,
            actions: m.actions.map((a) => ({ ...a, run })),
          }));
          const registry = createNodeActionRegistry(modules);
          const keys = modules.flatMap((m) =>
            m.actions.map((a) => actionKey(m.id, a.id)),
          );
          // 登録された鍵か、知らない鍵
          const key = keys.length > 0 ? keys[pick % keys.length] : 'none/x';
          const usable =
            !readOnly && expectedKeys(modules, content).includes(key as string);
          const attempt = () =>
            runNodeAction(
              registry,
              key as string,
              ctxWith(content),
              {},
              {
                readOnly,
              },
            );
          if (usable) {
            expect(attempt()).toBe(DUMMY_EVENT);
            expect(run).toHaveBeenCalledTimes(1);
          } else {
            expect(attempt).toThrow(NodeActionError);
            expect(run).not.toHaveBeenCalled();
          }
        },
      ),
    );
  });
});

describe('登録', () => {
  const empty = (id: string, actions: NodeAction[] = []): NodeModule => ({
    id,
    actions,
  });

  test('module の id・操作の id の重なりと、区切り文字 / を含む id は断る', () => {
    expect(() => createNodeActionRegistry([empty('m'), empty('m')])).toThrow(
      '重なる',
    );
    expect(() =>
      createNodeActionRegistry([
        empty('m', [tokenAction('x', 'a'), tokenAction('x', 'b')]),
      ]),
    ).toThrow('重なる');
    expect(() => createNodeActionRegistry([empty('a/b')])).toThrow();
    expect(() =>
      createNodeActionRegistry([empty('m', [tokenAction('x/y', 'a')])]),
    ).toThrow();
    expect(() => createNodeActionRegistry([empty('')])).toThrow();
  });

  test('別の module なら同じ操作の id でもよい (鍵は <module>/<action>)', () => {
    const registry = createNodeActionRegistry([
      empty('m1', [tokenAction('x', 'a')]),
      empty('m2', [tokenAction('x', 'a')]),
    ]);
    expect(
      registry.actionsFor(ctxWith('a'), { readOnly: false }).map((a) => a.key),
    ).toEqual(['m1/x', 'm2/x']);
  });

  test('available が投げる操作は出さない (画面を落とさない)', () => {
    const warn = mock(() => {});
    const original = console.warn;
    console.warn = warn;
    try {
      const registry = createNodeActionRegistry([
        empty('m', [
          {
            ...tokenAction('boom', 'a'),
            available: () => {
              throw new Error('boom');
            },
          },
          tokenAction('ok', 'a'),
        ]),
      ]);
      expect(
        registry
          .actionsFor(ctxWith('a'), { readOnly: false })
          .map((a) => a.key),
      ).toEqual(['m/ok']);
      expect(warn).toHaveBeenCalled();
    } finally {
      console.warn = original;
    }
  });
});

describe('印', () => {
  test('module の登録の順に並び、印の無い module と投げる module は飛ばす', () => {
    const original = console.warn;
    console.warn = () => {};
    try {
      const registry = createNodeActionRegistry([
        {
          id: 'first',
          actions: [],
          badge: () => ({ text: text('1'), tone: 'muted', value: 'one' }),
        },
        { id: 'none', actions: [], badge: () => undefined },
        { id: 'noBadge', actions: [] },
        {
          id: 'boom',
          actions: [],
          badge: () => {
            throw new Error('boom');
          },
        },
        {
          id: 'last',
          actions: [],
          badge: () => ({ text: text('2'), tone: 'primary', value: 'two' }),
        },
      ]);
      const node = ctxWith('').node;
      expect(
        registry
          .badgesFor({ node, outgoing: () => [] })
          .map((b) => [b.moduleId, b.badge.value]),
      ).toEqual([
        ['first', 'one'],
        ['last', 'two'],
      ]);
    } finally {
      console.warn = original;
    }
  });
});

describe('引数の確かめ', () => {
  const ACTORS: ActionParam = {
    name: 'to',
    kind: 'actors',
    label: text('宛先'),
  };
  const CHOICE: ActionParam = {
    name: 'where',
    kind: 'choice',
    label: text('置き場所'),
    options: [
      { value: 'linkedNode', label: text('node') },
      { value: 'newSheet', label: text('sheet') },
    ],
  };
  const BODY: ActionParam = {
    name: 'body',
    kind: 'text',
    label: text('本文'),
    required: true,
  };

  test('宣言どおりの値はそのまま。足りない actors は空、足りない任意の text は空文字', () => {
    const memo: ActionParam = {
      name: 'memo',
      kind: 'text',
      label: text('memo'),
    };
    expect(
      validateArgs([ACTORS, CHOICE, BODY, memo], {
        where: 'newSheet',
        body: '答え',
      }),
    ).toEqual({ to: [], where: 'newSheet', body: '答え', memo: '' });
  });

  test('知らない名前・選択肢に無い値・空白だけの必須の本文・配列でない actors は断る', () => {
    expect(() => validateArgs([ACTORS], { too: [] })).toThrow('知らない引数');
    expect(() => validateArgs([CHOICE], { where: 'self' })).toThrow(
      NodeActionError,
    );
    expect(() => validateArgs([CHOICE], {})).toThrow(NodeActionError);
    expect(() => validateArgs([BODY], { body: '  \n' })).toThrow('空');
    expect(() => validateArgs([ACTORS], { to: ALICE })).toThrow('DID の配列');
  });

  test('初めの値 (#393): 選択肢に無い値は先頭の選択肢に、形の違う値は空に、知らない名前は落とす', () => {
    const memo: ActionParam = {
      name: 'memo',
      kind: 'text',
      label: text('memo'),
    };
    expect(
      normalizeInitialArgs([ACTORS, CHOICE, memo], {
        to: [ALICE, 3, BOB],
        where: 'self',
        memo: 42,
        unknown: 'x',
      }),
    ).toEqual({ to: [ALICE, BOB], where: 'linkedNode', memo: '' });
    // 合う値はそのまま。無い値は無いまま (既定は dialog が決める)
    expect(
      normalizeInitialArgs([ACTORS, CHOICE, memo], {
        where: 'newSheet',
        memo: 'メモ',
      }),
    ).toEqual({ where: 'newSheet', memo: 'メモ' });
    expect(normalizeInitialArgs([ACTORS], { to: ALICE })).toEqual({ to: [] });
    // 直した値は確かめを通る (dialog の「実行」が詰まらない)
    expect(() =>
      validateArgs(
        [ACTORS, CHOICE],
        normalizeInitialArgs([ACTORS, CHOICE], { to: 'x', where: 'self' }),
      ),
    ).not.toThrow();
  });

  test('(性質) 初めの値を直すと、選択肢の値は選択肢の中・名前は宣言の中にあり、直し直しても変わらない (#393)', () => {
    const value = fc.constantFrom<unknown>(
      'linkedNode',
      'newSheet',
      'self',
      ALICE,
      [ALICE, BOB],
      [ALICE, 1],
      42,
      null,
    );
    fc.assert(
      fc.property(
        fc.dictionary(fc.constantFrom('to', 'where', 'body', 'other'), value),
        (initial) => {
          const params = [ACTORS, CHOICE, BODY];
          const once = normalizeInitialArgs(params, initial);
          for (const name of Object.keys(once)) {
            expect(['to', 'where', 'body']).toContain(name);
          }
          if (once.where !== undefined) {
            expect(['linkedNode', 'newSheet']).toContain(once.where as string);
          }
          expect(normalizeInitialArgs(params, once)).toEqual(once);
        },
      ),
    );
  });

  test('(性質) 確かめは冪等で、actors は同じ人を 1 度だけ持つ', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(ALICE, BOB), { maxLength: 6 }),
        (dids) => {
          const once = validateArgs([ACTORS], { to: dids });
          expect(validateArgs([ACTORS], once)).toEqual(once);
          expect(once.to).toEqual([...new Set(dids)]);
        },
      ),
    );
  });
});

describe('種', () => {
  test('module の種を登録の順に並べる (種を持たない module は何も足さない)', () => {
    const seed = (id: string) =>
      ({ template: { id, name: id, nodeKinds: [], edgeKinds: [] } }) as never;
    const registry = createNodeActionRegistry([
      { id: 'a', actions: [], seeds: [seed('a1'), seed('a2')] },
      { id: 'none', actions: [] },
      { id: 'b', actions: [], seeds: [seed('b1')] },
    ]);
    expect(registry.seeds.map((s) => String(s.template.id))).toEqual([
      'a1',
      'a2',
      'b1',
    ]);
  });
});

describe('知らせ', () => {
  const input = {
    fileId: '11111111-1111-4111-8111-111111111111' as never,
    local: [],
    incoming: [],
    viewer: ALICE,
  };
  const noticeOf = (key: string) => ({
    key,
    fileId: input.fileId,
    sheetId: '22222222-2222-4222-8222-222222222222' as never,
    nodeId: NODE as never,
    from: BOB,
    content: key,
  });

  test('知らせを持つ module の登録の順に集め、module の id を添える。投げる module は飛ばす', () => {
    const original = console.warn;
    console.warn = () => {};
    try {
      const source = (keys: string[]) => ({
        region: text('r'),
        heading: () => text('h'),
        detect: () => keys.map(noticeOf),
      });
      const registry = createNodeActionRegistry([
        { id: 'a', actions: [], notices: source(['1', '2']) },
        { id: 'quiet', actions: [] },
        {
          id: 'boom',
          actions: [],
          notices: {
            ...source([]),
            detect: () => {
              throw new Error('boom');
            },
          },
        },
        { id: 'b', actions: [], notices: source(['1']) },
      ]);
      const found = registry.detectNotices(input);
      expect(found.map((n) => [n.moduleId, n.key])).toEqual([
        ['a', '1'],
        ['a', '2'],
        ['b', '1'],
      ]);
      // 既読の鍵は module の間で重ならない
      expect(new Set(found.map(noticeKeyOf)).size).toBe(3);
      expect(registry.noticeSource('a')?.region.ja).toBe('r');
      expect(registry.noticeSource('quiet')).toBeUndefined();
    } finally {
      console.warn = original;
    }
  });
});
