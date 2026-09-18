import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { type Did, DtrIdSchema, SheetIdSchema } from '../schemas';
import { allApproved, type DtrJudgments, foldDtr } from './dtr';
import type { JudgmentBatch, JudgmentOp } from './judgment';
import { BatchIdSchema } from './unified';

const DTR = DtrIdSchema.parse(crypto.randomUUID());
const OTHER_DTR = DtrIdSchema.parse(crypto.randomUUID());
const SHEET = SheetIdSchema.parse(crypto.randomUUID());

const A: Did = 'did:plc:a';
const B: Did = 'did:plc:b';
/** 端末単位の actor。同じ人の 2 台目が別人にならないことを見るために 2 つ持つ */
const A1 = 'did:plc:a#dev1';
const A2 = 'did:plc:a#dev2';
const B1 = 'did:plc:b#dev1';

function batch(clock: number, actor: string, ops: JudgmentOp[]): JudgmentBatch {
  return {
    id: BatchIdSchema.parse(crypto.randomUUID()),
    actor,
    clock,
    timestamp: clock,
    ops,
  };
}

const open = (callees: readonly Did[]): JudgmentOp => ({
  kind: 'dtr.open',
  target: DTR,
  sheetId: SHEET,
  callees: [...callees],
});
const approve = (target = DTR): JudgmentOp => ({ kind: 'dtr.approve', target });
const setCallees = (callees: readonly Did[]): JudgmentOp => ({
  kind: 'dtr.setCallees',
  target: DTR,
  callees: [...callees],
});

const dtrOf = (j: DtrJudgments) => {
  const dtr = j.dtrs.get(DTR);
  if (!dtr) throw new Error('DTR が畳み込まれていない');
  return dtr;
};

describe('foldDtr', () => {
  test('起動すると、呼び出し対象と器が記録される', () => {
    const j = foldDtr([batch(1, A1, [open([A, B])])]);
    const dtr = dtrOf(j);

    expect([...dtr.callees].sort()).toEqual([A, B]);
    expect(dtr.approvals.size).toBe(0);
    expect(dtr.sheetId).toBe(SHEET);
    expect(dtr.openedAt).toBe(1);
    expect(j.rejected).toEqual([]);
  });

  test('呼び出された actor の承認が積み上がり、全員揃うと allApproved になる', () => {
    const j = foldDtr([
      batch(1, A1, [open([A, B])]),
      batch(2, A1, [approve()]),
    ]);
    expect(allApproved(dtrOf(j))).toBe(false);

    const both = foldDtr([
      batch(1, A1, [open([A, B])]),
      batch(2, A1, [approve()]),
      batch(3, B1, [approve()]),
    ]);
    expect(allApproved(dtrOf(both))).toBe(true);
  });

  // 承認は **DID 単位**である。端末ごとに数えると、2 台持ちの人が 1 人で「全員の承認」を
  // 作れてしまう / あるいは 1 台目で承認しても 2 台目の分が足りないことになる
  test('同じ人の別の端末からの承認も、その人 1 人の承認として数える', () => {
    const j = foldDtr([
      batch(1, A1, [open([A, B])]),
      batch(2, A2, [approve()]),
    ]);

    expect([...dtrOf(j).approvals]).toEqual([A]);
    expect(allApproved(dtrOf(j))).toBe(false);
  });

  // 2 度目を通すと、後から来た起動が呼び出し対象を書き換えられることになり、
  // 「呼び出し対象は起動時に確定する」(仕様「承認の判定」) が崩れる
  test('🔴 2 度目の起動は捨てる (呼び出し対象の書き換えを許さない)', () => {
    const j = foldDtr([
      batch(1, A1, [open([A, B])]),
      batch(2, B1, [open([B])]),
    ]);

    expect([...dtrOf(j).callees].sort()).toEqual([A, B]);
    expect(j.rejected.map((r) => r.reason)).toEqual(['duplicateOpen']);
  });

  test('起動されていない DtR への承認は捨てる', () => {
    const j = foldDtr([batch(1, A1, [approve(OTHER_DTR)])]);

    expect(j.dtrs.size).toBe(0);
    expect(j.rejected.map((r) => r.reason)).toEqual(['dtrNotOpen']);
  });

  test('呼び出されていない actor の承認は捨てる', () => {
    const j = foldDtr([batch(1, A1, [open([A])]), batch(2, B1, [approve()])]);

    expect([...dtrOf(j).approvals]).toEqual([]);
    expect(j.rejected.map((r) => r.reason)).toEqual(['issuerNotCallee']);
  });

  // 仕様「承認しない actor がいたら普通はそのまま (保留) だが, 呼び出し対象から外して
  // 先に進むこともできる」。これが無いと、全員が承認するまで DtR に出口が無い
  test('呼び出し対象から外すと、残りの全員の承認で揃う (保留の出口)', () => {
    const j = foldDtr([
      batch(1, A1, [open([A, B])]),
      batch(2, A1, [approve()]),
      batch(3, A1, [setCallees([A])]),
    ]);

    expect([...dtrOf(j).callees]).toEqual([A]);
    expect(allApproved(dtrOf(j))).toBe(true);
  });

  test('呼び出されていない actor は、呼び出し対象を変えられない', () => {
    const j = foldDtr([
      batch(1, A1, [open([A])]),
      batch(2, B1, [setCallees([B])]),
    ]);

    expect([...dtrOf(j).callees]).toEqual([A]);
    expect(j.rejected.map((r) => r.reason)).toEqual(['issuerNotCallee']);
  });

  test('起動されていない DtR の呼び出し対象は変えられない', () => {
    const j = foldDtr([batch(1, A1, [setCallees([A])])]);

    expect(j.rejected.map((r) => r.reason)).toEqual(['dtrNotOpen']);
  });

  // 同じ collection を 2 つの畳み込みが別々に読む。名簿の op がここに影響しないことは、
  // 混ぜて渡しても結果が変わらないことで示す (逆向きは `foldParticipation` 側が
  // `default` を持たないことで成り立っている)
  test('名簿の op は読み飛ばす (同じ collection を別々に畳む)', () => {
    const ops: JudgmentOp[] = [
      { kind: 'participation.genesis' },
      { kind: 'participation.invite', target: B },
      { kind: 'participation.resign' },
    ];
    const j = foldDtr([
      batch(1, A1, [open([A])]),
      batch(2, A1, ops),
      batch(3, A1, [approve()]),
    ]);

    expect(allApproved(dtrOf(j))).toBe(true);
    expect(j.rejected).toEqual([]);
  });

  test('捨てた op は batch 内の位置つきで返る (同じ op が 1 batch に 2 つ並びうる)', () => {
    const j = foldDtr([batch(1, A1, [open([A]), open([A, B])])]);

    expect(j.rejected).toHaveLength(1);
    expect(j.rejected[0]).toMatchObject({
      opIndex: 1,
      reason: 'duplicateOpen',
    });
  });
});

// --- 性質 ---
//
// 生成器は**小さなプール**にしてある (DID 2 人 / DtR 1 つ / clock 1-4)。広い生成器だと
// 同じ DID や同じ clock を引かないので、「2 度目の起動」「同着」「呼ばれていない人の承認」
// といった**境界に当たらない**。

const opArb: fc.Arbitrary<JudgmentOp> = fc.oneof(
  fc.constantFrom([A], [B], [A, B]).map(open),
  fc.constant(approve()),
  fc.constantFrom([A], [B], [A, B]).map(setCallees),
  // 名簿の op も混ぜる。読み飛ばしが性質の側でも保たれること
  fc.constant<JudgmentOp>({ kind: 'participation.resign' }),
);

const batchArb: fc.Arbitrary<JudgmentBatch> = fc
  .record({
    clock: fc.integer({ min: 1, max: 4 }),
    actor: fc.constantFrom(A1, A2, B1),
    ops: fc.array(opArb, { minLength: 1, maxLength: 2 }),
  })
  .map(({ clock, actor, ops }) => batch(clock, actor, ops));

/** 比較できる形にする。Set と Map は `toEqual` の対象にしにくい */
function snapshot(j: DtrJudgments) {
  return {
    dtrs: [...j.dtrs.values()]
      .map((d) => ({
        id: d.id,
        openedAt: d.openedAt,
        callees: [...d.callees].sort(),
        approvals: [...d.approvals].sort(),
      }))
      .sort((x, y) => x.id.localeCompare(y.id)),
    rejected: j.rejected
      .map((r) => `${r.batchId}:${r.opIndex}:${r.reason}`)
      .sort(),
  };
}

describe('foldDtr の性質', () => {
  // 実機の判断ログは受信順に並ぶ。畳み込みが自分で全順序に整列していることの確認で、
  // これが崩れると**端末によって結論が変わる**
  test('入力の順序に依らない', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(batchArb, fc.nat()), { maxLength: 8 }),
        (pairs) => {
          const batches = pairs.map(([b]) => b);
          const shuffled = [...pairs]
            .sort(([, x], [, y]) => x - y)
            .map(([b]) => b);

          expect(snapshot(foldDtr(shuffled))).toEqual(
            snapshot(foldDtr(batches)),
          );
        },
      ),
    );
  });

  // 仕様「承認は積み上がる一方なので、集合を固定すれば判定は単調になる」。呼び出し対象が
  // 変わっても承認を消さない、という設計判断がこれを支えている
  test('承認は消えない — 後ろに何を足しても、一度採択された承認は残る', () => {
    fc.assert(
      fc.property(
        fc.array(batchArb, { maxLength: 6 }),
        fc.array(batchArb, { maxLength: 4 }),
        (head, tail) => {
          // 後続はすべて後ろの clock に置く (「後から足す」を順序で表す)
          const later = tail.map((b, i) => batch(100 + i, b.actor, [...b.ops]));
          const before = foldDtr(head).dtrs.get(DTR);
          const after = foldDtr([...head, ...later]).dtrs.get(DTR);
          if (!before) return; // まだ起動されていなければ主張することがない

          if (!after) throw new Error('起動済の DtR が消えた');
          for (const did of before.approvals)
            expect(after.approvals.has(did)).toBe(true);
        },
      ),
    );
  });
});
