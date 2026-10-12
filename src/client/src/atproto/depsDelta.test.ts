import { describe, expect, test } from 'bun:test';
import type { FileId, VersionVector } from '@conversensus/shared';
import fc from 'fast-check';
import {
  type DepsCarrier,
  DepsDeltaEncoder,
  deltaDeps,
  restoreDeps,
} from './depsDelta';

const FILE = 'f1' as FileId;
const OTHER_FILE = 'f2' as FileId;
const A = 'did:plc:alice#d1';

describe('deltaDeps', () => {
  test('基より大きい項目だけを残す。基に無い項目は 0 と比べる', () => {
    expect(deltaDeps({ b: 3, c: 1, d: 5 }, { b: 3, c: 0, d: 4 })).toEqual({
      c: 1,
      d: 5,
    });
    expect(deltaDeps({ b: 2 }, {})).toEqual({ b: 2 });
    expect(deltaDeps({ b: 2 }, { b: 2 })).toEqual({});
  });
});

describe('DepsDeltaEncoder', () => {
  test('送れた実績が無ければ全体、あればその seq を基にした差分', () => {
    const enc = new DepsDeltaEncoder();
    const b1 = { actor: A, seq: 1, deps: { x: 1 } };
    const b2 = { actor: A, seq: 2, deps: { x: 1, y: 4 } };
    expect(enc.encode(FILE, b1)).toEqual({ deps: { x: 1 } });
    enc.confirm(FILE, b1);
    expect(enc.encode(FILE, b2)).toEqual({ deps: { y: 4 }, depsBase: 1 });
  });

  test('送れずに飛ばした batch は基にしない (受け手が持たないので)', () => {
    const enc = new DepsDeltaEncoder();
    enc.confirm(FILE, { actor: A, seq: 1, deps: { x: 1 } });
    // seq 2 は送れなかった (confirm しない)
    expect(enc.encode(FILE, { actor: A, seq: 3, deps: { x: 2 } })).toEqual({
      deps: { x: 2 },
      depsBase: 1,
    });
  });

  test('File ごとに別に覚える', () => {
    const enc = new DepsDeltaEncoder();
    enc.confirm(FILE, { actor: A, seq: 1, deps: { x: 1 } });
    expect(
      enc.encode(OTHER_FILE, { actor: A, seq: 2, deps: { x: 1 } }),
    ).toEqual({ deps: { x: 1 } });
  });
});

describe('restoreDeps', () => {
  test('差分を基の全体に足して戻す。基が取得の中に無いものは戻さない', () => {
    const items: DepsCarrier[] = [
      { actor: A, seq: 2, deps: { y: 4 }, depsBase: 1 },
      { actor: A, seq: 1, deps: { x: 1 } },
      { actor: A, seq: 5, deps: { z: 1 }, depsBase: 4 },
    ];
    const { restored, unresolved } = restoreDeps(items);
    expect(restored).toEqual(
      expect.arrayContaining([
        { actor: A, seq: 1, deps: { x: 1 } },
        { actor: A, seq: 2, deps: { x: 1, y: 4 } },
      ]),
    );
    expect(unresolved.map((i) => i.seq)).toEqual([5]);
  });

  /**
   * actor ごとに、seq が進むにつれて増えるだけの deps の列を作る。項目の actor は小さなプールから引く —
   * 広いと同じ actor の項目が続かず、「基と同じなので差分に載らない」場合に当たらない
   */
  const OTHERS = ['b', 'c', 'd'];
  const growingDeps = fc
    .array(
      fc.record({
        who: fc.constantFrom(...OTHERS),
        step: fc.integer({ min: 0, max: 3 }),
      }),
      { minLength: 1, maxLength: 12 },
    )
    .map((steps) => {
      const current: Record<string, number> = {};
      return steps.map(({ who, step }) => {
        current[who] = (current[who] ?? 0) + step;
        return Object.fromEntries(
          Object.entries(current).filter(([, v]) => v > 0),
        ) as VersionVector;
      });
    });
  const actorRun = (actor: string) =>
    fc
      .tuple(
        growingDeps,
        fc.array(fc.boolean(), { minLength: 12, maxLength: 12 }),
      )
      .map(([depsList, delivered]) =>
        depsList.map((deps, i) => ({
          batch: { actor, seq: i + 1, deps },
          delivered: delivered[i] ?? true,
        })),
      );

  test('性質: どこで送れなくても、届いたものは全体の deps に戻り、戻せないものは無い', () => {
    fc.assert(
      fc.property(
        actorRun('did:plc:alice#d1'),
        actorRun('did:plc:bob#d1'),
        fc.integer(),
        (aliceRun, bobRun, shuffleSeed) => {
          const enc = new DepsDeltaEncoder();
          const sent: (DepsCarrier & { original: VersionVector })[] = [];
          // 送り手は seq の順に試し、送れたものだけを覚える
          for (const { batch, delivered } of [...aliceRun, ...bobRun]) {
            const encoded = enc.encode(FILE, batch);
            if (!delivered) continue;
            enc.confirm(FILE, batch);
            sent.push({ ...batch, ...encoded, original: batch.deps });
          }
          // 受け手には順不同で届く
          const shuffled = [...sent].sort(
            (x, y) =>
              ((x.seq * 31 + shuffleSeed) % 7) -
              ((y.seq * 31 + shuffleSeed) % 7),
          );
          const { restored, unresolved } = restoreDeps(shuffled);
          expect(unresolved).toEqual([]);
          for (const item of restored) {
            expect(item.deps).toEqual(
              (item as unknown as { original: VersionVector }).original,
            );
            expect(item.depsBase).toBeUndefined();
          }
          expect(restored).toHaveLength(sent.length);
        },
      ),
    );
  });

  test('性質: 差分は全体より大きくならない', () => {
    fc.assert(
      fc.property(growingDeps, (list) => {
        for (let i = 1; i < list.length; i++) {
          const delta = deltaDeps(
            list[i] as VersionVector,
            list[i - 1] as VersionVector,
          );
          expect(Object.keys(delta).length).toBeLessThanOrEqual(
            Object.keys(list[i] as VersionVector).length,
          );
        }
      }),
    );
  });
});
