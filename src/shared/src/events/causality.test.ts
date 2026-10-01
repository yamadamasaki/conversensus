import { describe, expect, it } from 'bun:test';
import fc from 'fast-check';
import {
  type CausalPoint,
  concurrent,
  contiguousFrontier,
  depsFor,
  EMPTY_VECTOR,
  happenedBefore,
  heldMaxima,
  joinVectors,
  knowledgeOf,
  observe,
  type VersionVector,
} from './causality';
import { compareByClockActorId, LamportClock } from './unified';

type SimBatch = CausalPoint & { id: string; clock: number };

/**
 * 履歴を 1 つ作る指示。
 *
 * - `write`: その actor が batch を 1 つ書く
 * - `deliver`: `from` の書いた batch のうち `pick` で選んだもの (新しい方から数えた位置) を
 *   `to` が受け取る。**任意の部分集合を届ける**ので、歯抜けも、順序の入れ替わりも起きる
 */
type Step =
  | { kind: 'write'; actor: number }
  | { kind: 'deliver'; from: number; to: number; pick: number[] };

const ACTORS = 3;

const arbStep: fc.Arbitrary<Step> = fc.oneof(
  fc.record({
    kind: fc.constant('write' as const),
    actor: fc.integer({ min: 0, max: ACTORS - 1 }),
  }),
  fc.record({
    kind: fc.constant('deliver' as const),
    from: fc.integer({ min: 0, max: ACTORS - 1 }),
    to: fc.integer({ min: 0, max: ACTORS - 1 }),
    // 新しい方から数えた位置。**直近の batch に偏らせる** — 「A が書き、B がそれを見て書き、
    // C が B の分だけを受け取って書く」連鎖は、古い batch を拾う生成器ではめったに起きず、
    // 推移律の破れを見逃す (受け取った deps を知識に取り込まない変異が通った)
    pick: fc.array(fc.nat({ max: 2 }), { maxLength: 3 }),
  }),
);

type Replica = {
  actor: string;
  knowledge: VersionVector;
  clock: LamportClock;
  seq: number;
  /** 実際の因果の過去 (この replica が書く batch が「見た」ことになる batch の id) */
  truePast: Set<string>;
};

/**
 * 履歴を実行する。batch ごとに**実際の因果の過去**も記録しておき、
 * `happenedBefore` の答えと突き合わせる
 */
function simulate(steps: Step[]) {
  const replicas: Replica[] = Array.from({ length: ACTORS }, (_, i) => ({
    actor: `did:plc:${String.fromCharCode(97 + i)}#dev`,
    knowledge: EMPTY_VECTOR,
    clock: new LamportClock(),
    seq: 0,
    truePast: new Set(),
  }));
  const written: SimBatch[][] = replicas.map(() => []);
  const pastOf = new Map<string, Set<string>>();

  for (const step of steps) {
    if (step.kind === 'write') {
      const r = replicas[step.actor];
      r.seq += 1;
      const batch: SimBatch = {
        id: `${r.actor}/${r.seq}`,
        actor: r.actor,
        seq: r.seq,
        deps: depsFor(r.knowledge, r.actor),
        clock: r.clock.tick(),
      };
      pastOf.set(batch.id, new Set(r.truePast));
      written[step.actor].push(batch);
      r.knowledge = observe(r.knowledge, batch);
      r.truePast.add(batch.id);
      continue;
    }
    if (step.from === step.to) continue;
    const to = replicas[step.to];
    const source = written[step.from];
    for (const index of step.pick) {
      const batch = source[source.length - 1 - index];
      if (!batch) continue;
      to.knowledge = observe(to.knowledge, batch);
      to.clock.observe(batch.clock);
      to.truePast.add(batch.id);
      for (const id of pastOf.get(batch.id) ?? []) to.truePast.add(id);
    }
  }
  return { batches: written.flat(), pastOf };
}

const arbHistory = fc.array(arbStep, { minLength: 1, maxLength: 60 });
/** 因果の一致は連鎖が要るので、他より多く回す */
const CAUSALITY_RUNS = { numRuns: 500 };

describe('happenedBefore: 実際の因果と一致する', () => {
  it('あらゆる履歴で、a → b ⇔ b を書いた人が a を (直接または間接に) 見ていた', () => {
    fc.assert(
      fc.property(arbHistory, (steps) => {
        const { batches, pastOf } = simulate(steps);
        for (const a of batches) {
          for (const b of batches) {
            const expected = pastOf.get(b.id)?.has(a.id) ?? false;
            expect(happenedBefore(a, b)).toBe(expected);
          }
        }
      }),
      CAUSALITY_RUNS,
    );
  });

  it('あらゆる履歴で、→ は半順序である (非反射・推移的)', () => {
    fc.assert(
      fc.property(arbHistory, (steps) => {
        const { batches } = simulate(steps);
        for (const a of batches) {
          expect(happenedBefore(a, a)).toBe(false);
          for (const b of batches) {
            if (!happenedBefore(a, b)) continue;
            expect(happenedBefore(b, a)).toBe(false);
            for (const c of batches) {
              if (happenedBefore(b, c)) expect(happenedBefore(a, c)).toBe(true);
            }
          }
        }
      }),
    );
  });

  it('あらゆる履歴で、異なる 2 つは「前」「後」「並行」のちょうど 1 つである', () => {
    fc.assert(
      fc.property(arbHistory, (steps) => {
        const { batches } = simulate(steps);
        for (const a of batches) {
          for (const b of batches) {
            if (a.id === b.id) continue;
            const relations = [
              happenedBefore(a, b),
              happenedBefore(b, a),
              concurrent(a, b),
            ].filter(Boolean);
            expect(relations).toHaveLength(1);
          }
        }
      }),
    );
  });
});

describe('happenedBefore と畳み込みの全順序', () => {
  it('あらゆる履歴で、a → b なら全順序でも a が先に来る (vector は順序を置き換えない)', () => {
    fc.assert(
      fc.property(arbHistory, (steps) => {
        const { batches } = simulate(steps);
        for (const a of batches) {
          for (const b of batches) {
            if (happenedBefore(a, b)) {
              expect(compareByClockActorId(a, b)).toBeLessThan(0);
            }
          }
        }
      }),
    );
  });
});

describe('contiguousFrontier: 歯抜けを越えない', () => {
  const arbHeld = fc.array(
    fc.record({
      actor: fc.constantFrom('a', 'b'),
      seq: fc.integer({ min: 1, max: 8 }),
    }),
    { maxLength: 12 },
  );

  it('あらゆる手持ちで、到達点 k は「1〜k をすべて持ち、k+1 を持たない」', () => {
    fc.assert(
      fc.property(arbHeld, (held) => {
        const frontier = contiguousFrontier(held);
        for (const actor of ['a', 'b']) {
          const seqs = new Set(
            held.filter((p) => p.actor === actor).map((p) => p.seq),
          );
          const k = frontier[actor] ?? 0;
          for (let s = 1; s <= k; s++) expect(seqs.has(s)).toBe(true);
          expect(seqs.has(k + 1)).toBe(false);
        }
      }),
    );
  });
});

describe('例', () => {
  const point = (actor: string, seq: number, deps: VersionVector = {}) => ({
    actor,
    seq,
    deps,
  });

  it('推移: B が A を見て書き、C が B だけを受け取って書いても、A は C より前', () => {
    const a = point('A', 1);
    const b = point('B', 1, depsFor(knowledgeOf([a]), 'B'));
    // C は a を持っていない。b だけを受け取った
    const c = point('C', 1, depsFor(knowledgeOf([b]), 'C'));
    expect(happenedBefore(a, c)).toBe(true);
  });

  it('自分の分は deps に載せない (seq - 1 と決まっている)', () => {
    expect(depsFor({ A: 3, B: 2 }, 'A')).toEqual({ B: 2 });
  });

  it('joinVectors は各項目の最大', () => {
    expect(joinVectors({ A: 3, B: 1 }, { B: 4, C: 2 })).toEqual({
      A: 3,
      B: 4,
      C: 2,
    });
  });

  it('heldMaxima は歯抜けを気にせず、actor ごとの最大の seq を返す', () => {
    expect(
      heldMaxima([
        { actor: 'A', seq: 1 },
        { actor: 'A', seq: 4 },
        { actor: 'B', seq: 2 },
      ]),
    ).toEqual({ A: 4, B: 2 });
  });

  it('到達点は歯抜けの手前で止まる', () => {
    expect(
      contiguousFrontier([
        { actor: 'A', seq: 1 },
        { actor: 'A', seq: 2 },
        { actor: 'A', seq: 4 },
        { actor: 'B', seq: 2 },
      ]),
    ).toEqual({ A: 2 });
  });
});
