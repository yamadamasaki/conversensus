import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { authorsOf } from './authors';
import {
  type Batch,
  compareByClockActorId,
  didFromActor,
  type Op,
} from './unified';

const N1 = '11111111-1111-4111-8111-111111111111';
const N2 = '22222222-2222-4222-8222-222222222222';
const E1 = '33333333-3333-4333-8333-333333333333';
const ALICE = 'did:plc:alice';
const BOB = 'did:plc:bob';
const AGENT = 'did:plc:agent';

let counter = 0;
function batch(did: string, clock: number, ops: Op[]): Batch {
  counter += 1;
  return {
    id: `b${String(counter).padStart(6, '0')}`,
    actor: `${did}#dev`,
    clock,
    seq: counter,
    deps: {},
    timestamp: clock,
    ops,
  } as unknown as Batch;
}
const op = (kind: string, target: string, extra: object = {}) =>
  ({ kind, target, ...extra }) as unknown as Op;

describe('authorsOf (例)', () => {
  test('作った人を先頭に、あとは最後に書いた順 (新しい順)', () => {
    const authors = authorsOf([
      batch(ALICE, 1, [op('node.add', N1, { content: '' })]),
      batch(BOB, 2, [op('node.setContent', N1, { content: 'b' })]),
      batch(AGENT, 3, [op('node.setProperty', N1, { name: 'x', value: 1 })]),
      batch(BOB, 4, [op('node.setLabel', N1, { label: 'l' })]),
    ]);
    expect(authors.get(N1)).toEqual([ALICE, BOB, AGENT]);
  });

  test('位置と見た目を変えただけの人・消した人は数えない', () => {
    const authors = authorsOf([
      batch(ALICE, 1, [op('node.add', N1, { content: '' })]),
      batch(BOB, 2, [
        op('node.setLayout', N1, { x: 1, y: 1 }),
        op('node.setStyle', N1, {}),
      ]),
      batch(AGENT, 3, [op('node.remove', N1)]),
    ]);
    expect(authors.get(N1)).toEqual([ALICE]);
  });

  test('edge も同じ。つなぎ替えは書いたに数え、label の位置は数えない', () => {
    const authors = authorsOf([
      batch(ALICE, 1, [op('edge.add', E1, { source: N1, dest: N2 })]),
      batch(BOB, 2, [op('edge.reconnect', E1, { source: N2, dest: N1 })]),
      batch(AGENT, 3, [op('edge.setLabelOffset', E1, {})]),
    ]);
    expect(authors.get(E1)).toEqual([ALICE, BOB]);
  });

  test('同じ端末の別の device も同じ人。未ログインの actor (local) は数えない', () => {
    const authors = authorsOf([
      {
        ...batch(ALICE, 1, [op('node.add', N1, { content: '' })]),
        actor: `${ALICE}#phone`,
      } as Batch,
      batch(ALICE, 2, [op('node.setContent', N1, { content: 'x' })]),
      batch('local', 3, [op('node.setContent', N1, { content: 'y' })]),
    ]);
    expect(authors.get(N1)).toEqual([ALICE]);
  });

  test('作成の op が手元に無い要素 (受信の途中など) は、書いた人を最後に書いた順に並べる', () => {
    const authors = authorsOf([
      batch(BOB, 2, [op('node.setContent', N1, { content: 'b' })]),
      batch(AGENT, 5, [op('node.setContent', N1, { content: 'c' })]),
    ]);
    expect(authors.get(N1)).toEqual([AGENT, BOB]);
  });
});

describe('authorsOf (性質)', () => {
  /** 小さなプール: 要素 3 つ・人 3 人 + 未ログイン・op は数えるもの数えないもの両方 */
  const target = fc.constantFrom(N1, N2, E1);
  const actorDid = fc.constantFrom(ALICE, BOB, AGENT, 'local');
  const kind = fc.constantFrom(
    'node.add',
    'node.setContent',
    'node.setProperty',
    'node.setLayout',
    'node.setStyle',
    'node.remove',
    'edge.add',
    'edge.reconnect',
    'edge.setLabelOffset',
  );
  const counted = new Set([
    'node.add',
    'node.setContent',
    'node.setProperty',
    'edge.add',
    'edge.reconnect',
  ]);
  const batchesArb = fc.array(
    fc.record({
      did: actorDid,
      clock: fc.nat({ max: 6 }),
      ops: fc.array(fc.record({ kind, target }), {
        minLength: 1,
        maxLength: 3,
      }),
    }),
    { maxLength: 10 },
  );
  const build = (
    specs: {
      did: string;
      clock: number;
      ops: { kind: string; target: string }[];
    }[],
  ) =>
    specs.map((s) =>
      batch(
        s.did,
        s.clock,
        s.ops.map((o) => op(o.kind, o.target)),
      ),
    );

  test('作者は、その要素に数える op を出した人ちょうど (重ならず、未ログインを含まない)。batch の並びに依らない', () => {
    fc.assert(
      fc.property(batchesArb, fc.nat(), (specs, seed) => {
        const batches = build(specs);
        const authors = authorsOf(batches);
        for (const id of [N1, N2, E1]) {
          const expected = new Set(
            batches
              .filter((b) => didFromActor(b.actor) !== 'local')
              .filter((b) =>
                b.ops.some(
                  (o) =>
                    counted.has(o.kind) && 'target' in o && o.target === id,
                ),
              )
              .map((b) => didFromActor(b.actor)),
          );
          const got = authors.get(id) ?? [];
          expect(new Set(got)).toEqual(expected);
          expect(got.length).toBe(expected.size);
        }
        // 並びを入れ替えても同じ
        const shuffled = [...batches].sort(
          (a, b) => ((a.seq * 7919 + seed) % 97) - ((b.seq * 7919 + seed) % 97),
        );
        expect(authorsOf(shuffled)).toEqual(authors);
      }),
    );
  });

  test('作られていれば、最初に作った人が先頭。残りは最後に書いた順', () => {
    fc.assert(
      fc.property(batchesArb, (specs) => {
        const sorted = build(specs)
          .filter((b) => didFromActor(b.actor) !== 'local')
          .sort(compareByClockActorId);
        const authors = authorsOf(sorted);
        for (const id of [N1, N2, E1]) {
          const touches = (b: Batch, kinds: (k: string) => boolean) =>
            b.ops.some(
              (o) => kinds(o.kind) && 'target' in o && o.target === id,
            );
          const creating = sorted.find((b) =>
            touches(b, (k) => k === 'node.add' || k === 'edge.add'),
          );
          const got = authors.get(id) ?? [];
          if (creating) expect(got[0]).toBe(didFromActor(creating.actor));
          const lastIndex = (did: string) =>
            sorted.findLastIndex(
              (b) =>
                didFromActor(b.actor) === did &&
                touches(b, (k) => counted.has(k)),
            );
          const rest = creating ? got.slice(1) : got;
          for (let i = 1; i < rest.length; i++) {
            expect(lastIndex(rest[i - 1] as string)).toBeGreaterThan(
              lastIndex(rest[i] as string),
            );
          }
        }
      }),
    );
  });
});
