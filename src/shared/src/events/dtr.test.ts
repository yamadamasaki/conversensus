import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  BranchIdSchema,
  type Did,
  DtrIdSchema,
  SheetIdSchema,
} from '../schemas';
import { allApproved, canRemergeAt, type DtrJudgments, foldDtr } from './dtr';
import type { JudgmentBatch, JudgmentOp } from './judgment';
import { foldParticipation } from './participation';
import { BatchIdSchema } from './unified';

const DTR = DtrIdSchema.parse(crypto.randomUUID());
const OTHER_DTR = DtrIdSchema.parse(crypto.randomUUID());
const SHEET = SheetIdSchema.parse(crypto.randomUUID());
/** 起動の原因となった branch (merge した branch, または競合が作った fork) */
const BRANCH = BranchIdSchema.parse(crypto.randomUUID());

const A: Did = 'did:plc:a';
const B: Did = 'did:plc:b';
/** 名簿に一度も現れない DID (「見えていない」と「去った」を分けるため) */
const UNSEEN: Did = 'did:plc:unseen';
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

/**
 * 同じ batch 列を 2 つの畳み込みに通す。
 *
 * **名簿を手で作らない。**DtR は名簿に依存する (D2) が、その名簿は同じ判断ログから
 * 畳んだものである。偽物を組むと「2 つの畳み込みが同じログを別々に読む」という設計
 * そのものが検証から抜ける。
 */
const fold = (batches: JudgmentBatch[]): DtrJudgments =>
  foldDtr(batches, {
    participation: foldParticipation(batches, { isLocalDid: () => true }),
  });

/** 解決グラフの器として切った作業用 branch (D3)。原因の BRANCH とは別物 */
const RESOLVE = BranchIdSchema.parse(crypto.randomUUID());

const open = (callees: readonly Did[]): JudgmentOp => ({
  kind: 'dtr.open',
  target: DTR,
  branchId: BRANCH,
  resolveBranchId: RESOLVE,
  sheetId: SHEET,
  callees: [...callees],
});
const approve = (target = DTR): JudgmentOp => ({ kind: 'dtr.approve', target });
const setCallees = (callees: readonly Did[]): JudgmentOp => ({
  kind: 'dtr.setCallees',
  target: DTR,
  callees: [...callees],
});

// --- 名簿の op (D2 の離脱を作るため) ---
const genesis: JudgmentOp = { kind: 'participation.genesis' };
const invite = (target: Did): JudgmentOp => ({
  kind: 'participation.invite',
  target,
});
const accept = (inviter: Did): JudgmentOp => ({
  kind: 'participation.accept',
  inviter,
});
const resign: JudgmentOp = { kind: 'participation.resign' };

/** A と B が参加している名簿を作る (clock 1-3) */
const roster2 = () => [
  batch(1, A1, [genesis]),
  batch(2, A1, [invite(B)]),
  batch(3, B1, [accept(A)]),
];

const dtrOf = (j: DtrJudgments) => {
  const dtr = j.dtrs.get(DTR);
  if (!dtr) throw new Error('DTR が畳み込まれていない');
  return dtr;
};

describe('foldDtr', () => {
  test('起動すると、呼び出し対象と器が記録される', () => {
    const j = fold([batch(1, A1, [open([A, B])])]);
    const dtr = dtrOf(j);

    expect([...dtr.callees].sort()).toEqual([A, B]);
    expect(dtr.approvals.size).toBe(0);
    expect(dtr.sheetId).toBe(SHEET);
    // 何がこの DtR を必要にしたか。仕様は merge 操作 / fork に紐づけると定める
    expect(dtr.branchId).toBe(BRANCH);
    // 解決の場。原因 (branchId) と取り違えないことを固定する
    expect(dtr.resolveBranchId).toBe(RESOLVE);
    expect(dtr.openedAt).toBe(1);
    expect(j.rejected).toEqual([]);
  });

  test('呼び出された actor の承認が積み上がり、全員揃うと allApproved になる', () => {
    const j = fold([batch(1, A1, [open([A, B])]), batch(2, A1, [approve()])]);
    expect(allApproved(dtrOf(j))).toBe(false);

    const both = fold([
      batch(1, A1, [open([A, B])]),
      batch(2, A1, [approve()]),
      batch(3, B1, [approve()]),
    ]);
    expect(allApproved(dtrOf(both))).toBe(true);
    // 揃った**位置**を持つ。再 merge の pre 条件が clock の比較だからである
    expect(dtrOf(both).satisfiedAt).toBe(3);
  });

  // 承認は **DID 単位**である。端末ごとに数えると、2 台持ちの人が 1 人で「全員の承認」を
  // 作れてしまう / あるいは 1 台目で承認しても 2 台目の分が足りないことになる
  test('同じ人の別の端末からの承認も、その人 1 人の承認として数える', () => {
    const j = fold([batch(1, A1, [open([A, B])]), batch(2, A2, [approve()])]);

    expect([...dtrOf(j).approvals]).toEqual([A]);
    expect(allApproved(dtrOf(j))).toBe(false);
  });

  // 2 度目を通すと、後から来た起動が呼び出し対象を書き換えられることになり、
  // 「呼び出し対象は起動時に確定する」(仕様「承認の判定」) が崩れる
  test('🔴 2 度目の起動は捨てる (呼び出し対象の書き換えを許さない)', () => {
    const j = fold([batch(1, A1, [open([A, B])]), batch(2, B1, [open([B])])]);

    expect([...dtrOf(j).callees].sort()).toEqual([A, B]);
    expect(j.rejected.map((r) => r.reason)).toEqual(['duplicateOpen']);
  });

  test('起動されていない DtR への承認は捨てる', () => {
    const j = fold([batch(1, A1, [approve(OTHER_DTR)])]);

    expect(j.dtrs.size).toBe(0);
    expect(j.rejected.map((r) => r.reason)).toEqual(['dtrNotOpen']);
  });

  test('呼び出されていない actor の承認は捨てる', () => {
    const j = fold([batch(1, A1, [open([A])]), batch(2, B1, [approve()])]);

    expect([...dtrOf(j).approvals]).toEqual([]);
    expect(j.rejected.map((r) => r.reason)).toEqual(['issuerNotCallee']);
  });

  // 仕様「承認しない actor がいたら普通はそのまま (保留) だが, 呼び出し対象から外して
  // 先に進むこともできる」。これが無いと、全員が承認するまで DtR に出口が無い
  test('呼び出し対象から外すと、残りの全員の承認で揃う (保留の出口)', () => {
    const j = fold([
      batch(1, A1, [open([A, B])]),
      batch(2, A1, [approve()]),
      batch(3, A1, [setCallees([A])]),
    ]);

    expect([...dtrOf(j).callees]).toEqual([A]);
    expect(allApproved(dtrOf(j))).toBe(true);
  });

  test('呼び出されていない actor は、呼び出し対象を変えられない', () => {
    const j = fold([
      batch(1, A1, [open([A])]),
      batch(2, B1, [setCallees([B])]),
    ]);

    expect([...dtrOf(j).callees]).toEqual([A]);
    expect(j.rejected.map((r) => r.reason)).toEqual(['issuerNotCallee']);
  });

  test('起動されていない DtR の呼び出し対象は変えられない', () => {
    const j = fold([batch(1, A1, [setCallees([A])])]);

    expect(j.rejected.map((r) => r.reason)).toEqual(['dtrNotOpen']);
  });

  // 同じ collection を 2 つの畳み込みが別々に読む。名簿の op がここに影響しないことは、
  // 混ぜて渡しても結果が変わらないことで示す (逆向きは `foldParticipation` 側が
  // `default` を持たないことで成り立っている)
  test('名簿の op は読み飛ばす (同じ collection を別々に畳む)', () => {
    const j = fold([
      batch(1, A1, [open([A])]),
      batch(2, A1, [genesis, invite(B), resign]),
      batch(3, A1, [approve()]),
    ]);

    expect(allApproved(dtrOf(j))).toBe(true);
    expect(j.rejected).toEqual([]);
  });

  test('捨てた op は batch 内の位置つきで返る (同じ op が 1 batch に 2 つ並びうる)', () => {
    const j = fold([batch(1, A1, [open([A]), open([A, B])])]);

    expect(j.rejected).toHaveLength(1);
    expect(j.rejected[0]).toMatchObject({
      opIndex: 1,
      reason: 'duplicateOpen',
    });
  });
});

// --- 離脱した呼び出し対象 (step2 Phase 6 D2) ---
//
// 仕様: 「呼び出された actor が承認しないまま参加を取りやめたら, 呼び出し対象から
// **自動的に外れる**. 残りの全員で判定する」。**去った人の承認を待って DtR が永久に
// 決着しなくなる**のを防ぐための規則である。

describe('foldDtr — 離脱した呼び出し対象 (D2)', () => {
  test('🔴 承認しないまま離脱した対象は外れ、残りの全員で揃う', () => {
    const j = fold([
      ...roster2(),
      batch(4, A1, [open([A, B])]),
      batch(5, A1, [approve()]),
      // B は承認しないまま参加を取りやめる
      batch(6, B1, [resign]),
    ]);

    expect(allApproved(dtrOf(j))).toBe(true);
    // 揃ったのは**離脱の位置**である。引き金は承認だけではない
    expect(dtrOf(j).satisfiedAt).toBe(6);
    // 記録された集合そのものは変えない (畳み込みは記録を書き換えない)
    expect([...dtrOf(j).callees].sort()).toEqual([A, B]);
  });

  test('離脱するまでは揃わない (残っている対象は待つ)', () => {
    const j = fold([
      ...roster2(),
      batch(4, A1, [open([A, B])]),
      batch(5, A1, [approve()]),
    ]);

    expect(allApproved(dtrOf(j))).toBe(false);
  });

  // 承認は積み上がる一方である (仕様の単調性)。後から去ったことで既に出た承認が
  // 消えるのは筋が通らない
  test('🔴 承認済みの人が後から離脱しても、その承認は数え続ける', () => {
    const j = fold([
      ...roster2(),
      batch(4, A1, [open([A, B])]),
      batch(5, B1, [approve()]),
      batch(6, B1, [resign]),
      batch(7, A1, [approve()]),
    ]);

    expect(dtrOf(j).satisfiedAt).toBe(7);
    expect([...dtrOf(j).approvals].sort()).toEqual([A, B]);
  });

  /**
   * **外すのは「観測できた離脱」だけである。**名簿に一度も現れない DID は「去った」
   * のではなく「こちらからは見えていない」。見えないことを理由に外すと、名簿の
   * 食い違いがそのまま判定の食い違いになり、**記録された集合に対して判定する**という
   * 仕様の要点が崩れる (a の手元では再 merge 可能, b の手元では保留が同時に成立する)。
   */
  test('🔴 名簿に一度も現れない対象は外さない', () => {
    const j = fold([
      ...roster2(),
      batch(4, A1, [open([A, UNSEEN])]),
      batch(5, A1, [approve()]),
    ]);

    expect(allApproved(dtrOf(j))).toBe(false);
  });

  // 空集合を「全員承認」と読むと、誰も承認していない DtR が自動的に再 merge 可能になる
  test('🔴 全員が去った DtR は決着しない', () => {
    const j = fold([
      ...roster2(),
      batch(4, A1, [open([A])]),
      batch(5, A1, [resign]),
    ]);

    expect(allApproved(dtrOf(j))).toBe(false);
    expect(dtrOf(j).satisfiedAt).toBeUndefined();
  });

  // 仕様「集合を固定すれば判定は単調になり, 後から参加者が増えても既に出た結論は
  // ひっくり返らない」
  test('🔴 一度揃ったら、後から対象が増えても位置は動かない', () => {
    const j = fold([
      ...roster2(),
      batch(4, A1, [open([A])]),
      batch(5, A1, [approve()]),
      batch(6, A1, [setCallees([A, B])]),
    ]);

    expect(dtrOf(j).satisfiedAt).toBe(5);
    expect(allApproved(dtrOf(j))).toBe(true);
  });
});

describe('canRemergeAt', () => {
  const satisfied = () =>
    dtrOf(fold([batch(1, A1, [open([A])]), batch(2, A1, [approve()])]));

  test('揃っていなければ、どの位置でも再 merge できない', () => {
    const pending = dtrOf(fold([batch(1, A1, [open([A, B])])]));
    expect(canRemergeAt(pending, 99)).toBe(false);
  });

  /**
   * pre 条件は「承認が**この操作より前に**記録されていること」である。同着を許さないのは、
   * 同じ clock の順序が `(actor, id)` の tiebreak で決まり、「より前」が意図どおりに
   * ならないためである。
   */
  test('🔴 揃った位置と同じ clock では再 merge できない (「より前」の意味)', () => {
    const dtr = satisfied();
    expect(dtr.satisfiedAt).toBe(2);
    expect(canRemergeAt(dtr, 2)).toBe(false);
    expect(canRemergeAt(dtr, 3)).toBe(true);
  });
});

// --- 性質 ---
//
// 生成器は**小さなプール**にしてある (DID 2 人 / DtR 1 つ / clock 1-4)。広い生成器だと
// 同じ DID や同じ clock を引かないので、「2 度目の起動」「同着」「呼ばれていない人の承認」
// といった**境界に当たらない**。名簿の op も混ぜる — D2 で DtR が名簿に依存するように
// なったので、離脱が絡む順序も性質の対象に入れる。

const opArb: fc.Arbitrary<JudgmentOp> = fc.oneof(
  fc.constantFrom([A], [B], [A, B]).map(open),
  fc.constant(approve()),
  fc.constantFrom([A], [B], [A, B]).map(setCallees),
  fc.constant(genesis),
  fc.constant(invite(B)),
  fc.constant(accept(A)),
  fc.constant(resign),
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
        satisfiedAt: d.satisfiedAt ?? null,
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

          expect(snapshot(fold(shuffled))).toEqual(snapshot(fold(batches)));
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
          const before = fold(head).dtrs.get(DTR);
          const after = fold([...head, ...later]).dtrs.get(DTR);
          if (!before) return; // まだ起動されていなければ主張することがない

          if (!after) throw new Error('起動済の DtR が消えた');
          for (const did of before.approvals)
            expect(after.approvals.has(did)).toBe(true);
        },
      ),
    );
  });

  // 仕様「不完全な情報しか持たない手元でも早まった結論を出せない」。決着の位置が後から
  // 動くと、**既に出た再 merge の可否がひっくり返る**
  test('🔴 一度決着したら、後ろに何を足しても位置は動かない', () => {
    fc.assert(
      fc.property(
        fc.array(batchArb, { maxLength: 6 }),
        fc.array(batchArb, { maxLength: 4 }),
        (head, tail) => {
          const later = tail.map((b, i) => batch(100 + i, b.actor, [...b.ops]));
          const before = fold(head).dtrs.get(DTR);
          if (before?.satisfiedAt === undefined) return;

          const after = fold([...head, ...later]).dtrs.get(DTR);
          expect(after?.satisfiedAt).toBe(before.satisfiedAt);
        },
      ),
    );
  });
});
