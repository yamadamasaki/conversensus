import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import type { JudgmentBatch, JudgmentOp } from './judgment';
import { foldParticipation, wasParticipatingAt } from './participation';
import type { BatchId } from './unified';

const A = 'did:plc:alice';
const B = 'did:plc:bob';
const C = 'did:plc:carol';
const FOREIGN = 'did:plc:elsewhere';

/** この PDS に属する DID。仕様は他 PDS のアカウントの招待を「無効とする」 */
const LOCAL = new Set([A, B, C]);
const deps = { isLocalDid: (did: string) => LOCAL.has(did) };

let seq = 0;
const bid = () =>
  `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}` as BatchId;

/** 判断 batch を 1 つ作る。actor は `<did>#<deviceId>` の複合である */
const jb = (
  did: string,
  clock: number,
  ops: JudgmentOp[],
  device = 'dev-1',
): JudgmentBatch => ({
  id: bid(),
  actor: `${did}#${device}`,
  clock,
  timestamp: 0,
  ops,
});

const genesis = (): JudgmentOp => ({ kind: 'participation.genesis' });
const invite = (target: string): JudgmentOp => ({
  kind: 'participation.invite',
  target,
});
const accept = (): JudgmentOp => ({ kind: 'participation.accept' });
const resign = (): JudgmentOp => ({ kind: 'participation.resign' });
const revoke = (target: string): JudgmentOp => ({
  kind: 'participation.revoke',
  target,
});

const reasons = (r: ReturnType<typeof foldParticipation>) =>
  r.rejected.map((x) => x.reason);

describe('genesis — 名簿の起点', () => {
  test('genesis を出した actor が最初の参加者になる', () => {
    const r = foldParticipation([jb(A, 1, [genesis()])], deps);
    expect([...r.participating]).toEqual([A]);
    expect(r.rejected).toEqual([]);
  });

  test('genesis より前は、あらゆる op が pre 条件で落ちる', () => {
    // これが「最初の 1 人は genesis でしか決まらない」ことの担保である
    const r = foldParticipation(
      [jb(A, 1, [invite(B)]), jb(B, 2, [accept()]), jb(A, 3, [genesis()])],
      deps,
    );
    expect(reasons(r)).toEqual(['issuerNotParticipating', 'issuerNotInvited']);
    expect([...r.participating]).toEqual([A]);
  });

  test('2 つ目の genesis は捨てられる', () => {
    // 自己申告でよいのは「起点と繋がっていなければ読まれない」からだが、
    // 読まれてしまった場合に 2 人目の起点を作らせない
    const r = foldParticipation(
      [jb(A, 1, [genesis()]), jb(B, 2, [genesis()])],
      deps,
    );
    expect(reasons(r)).toEqual(['duplicateGenesis']);
    expect([...r.participating]).toEqual([A]);
  });
});

describe('招待と承認', () => {
  test('招待 → 承認で名簿に載る', () => {
    const r = foldParticipation(
      [jb(A, 1, [genesis()]), jb(A, 2, [invite(B)]), jb(B, 3, [accept()])],
      deps,
    );
    expect([...r.participating].sort()).toEqual([A, B]);
    expect(r.invited.size).toBe(0);
    expect(r.rejected).toEqual([]);
  });

  test('招待されていない actor の承認は捨てられる', () => {
    // 参加コードは秘密ではないので、第三者が入手しうる。ここで落ちることが
    // 「入手しても参加できない」の担保である
    const r = foldParticipation(
      [jb(A, 1, [genesis()]), jb(A, 2, [invite(B)]), jb(C, 3, [accept()])],
      deps,
    );
    expect(reasons(r)).toEqual(['issuerNotInvited']);
    expect([...r.participating]).toEqual([A]);
  });

  test('参加者でない actor の招待は捨てられる', () => {
    const r = foldParticipation(
      [jb(A, 1, [genesis()]), jb(B, 2, [invite(C)])],
      deps,
    );
    expect(reasons(r)).toEqual(['issuerNotParticipating']);
  });

  test('他 PDS の DID への招待は捨てられる', () => {
    // 仕様は「やらない」ではなく**「無効とする」**と定めているので、
    // UI の入力チェックではなく pre 条件である
    const r = foldParticipation(
      [jb(A, 1, [genesis()]), jb(A, 2, [invite(FOREIGN)])],
      deps,
    );
    expect(reasons(r)).toEqual(['targetForeignPds']);
    expect(r.invited.size).toBe(0);
  });

  test('既に参加している actor への招待は捨てられる', () => {
    const r = foldParticipation(
      [
        jb(A, 1, [genesis()]),
        jb(A, 2, [invite(B)]),
        jb(B, 3, [accept()]),
        jb(A, 4, [invite(B)]),
      ],
      deps,
    );
    expect(reasons(r)).toEqual(['targetAlreadyParticipating']);
  });

  test('招待済への再招待は捨てず、招待者を上書きする', () => {
    // 参加コードの再発行は正当な操作で、名簿の結果も変わらない
    const r = foldParticipation(
      [
        jb(A, 1, [genesis()]),
        jb(A, 2, [invite(B)]),
        jb(A, 3, [invite(C)]),
        jb(C, 4, [accept()]),
        jb(C, 5, [invite(B)]),
      ],
      deps,
    );
    expect(r.rejected).toEqual([]);
    expect(r.invited.get(B)).toBe(C);
  });

  test('招待者は一覧に出せる — UI が「誰が招待したか」を示すため', () => {
    const r = foldParticipation(
      [jb(A, 1, [genesis()]), jb(A, 2, [invite(B)])],
      deps,
    );
    expect(r.invited.get(B)).toBe(A);
  });
});

describe('取り消しと参加取りやめ', () => {
  test('取り消しは承認の前後を問わず同じ op である', () => {
    // 招待済のまま取り消す
    const before = foldParticipation(
      [jb(A, 1, [genesis()]), jb(A, 2, [invite(B)]), jb(A, 3, [revoke(B)])],
      deps,
    );
    expect(before.invited.size).toBe(0);
    expect(before.rejected).toEqual([]);

    // 承認後に取り消す
    const after = foldParticipation(
      [
        jb(A, 1, [genesis()]),
        jb(A, 2, [invite(B)]),
        jb(B, 3, [accept()]),
        jb(A, 4, [revoke(B)]),
      ],
      deps,
    );
    expect([...after.participating]).toEqual([A]);
    expect(after.rejected).toEqual([]);
  });

  test('名簿にいない actor の取り消しは捨てられる', () => {
    const r = foldParticipation(
      [jb(A, 1, [genesis()]), jb(A, 2, [revoke(C)])],
      deps,
    );
    expect(reasons(r)).toEqual(['targetNotInRoster']);
  });

  test('取り消し合いは、誰の手元でも同じ結論になる', () => {
    // a が a' を取り消した後、それを知らない a' が「a の取り消し」を出す。
    // clock 順では a' は既に名簿にいないので pre 条件を満たさない。
    // 検証しないと取り消された側が取り消し返せて、手元によって結論が変わる
    const r = foldParticipation(
      [
        jb(A, 1, [genesis()]),
        jb(A, 2, [invite(B)]),
        jb(B, 3, [accept()]),
        jb(A, 4, [revoke(B)]),
        jb(B, 5, [revoke(A)]),
      ],
      deps,
    );
    expect([...r.participating]).toEqual([A]);
    expect(reasons(r)).toEqual(['issuerNotParticipating']);
  });

  test('参加を取りやめると名簿から外れる', () => {
    const r = foldParticipation(
      [
        jb(A, 1, [genesis()]),
        jb(A, 2, [invite(B)]),
        jb(B, 3, [accept()]),
        jb(B, 4, [resign()]),
      ],
      deps,
    );
    expect([...r.participating]).toEqual([A]);
  });
});

describe('actor は端末単位だが、名簿は DID 単位である', () => {
  test('同じ DID の別端末は 1 人として数える', () => {
    // これを取り違えると、2 台目で開いただけで参加者が増える
    const r = foldParticipation(
      [
        jb(A, 1, [genesis()], 'dev-1'),
        jb(A, 2, [invite(B)], 'dev-2'),
        jb(B, 3, [accept()], 'phone'),
      ],
      deps,
    );
    expect([...r.participating].sort()).toEqual([A, B]);
    expect(r.rejected).toEqual([]);
  });
});

describe('参加期間', () => {
  test('参加・取りやめ・再参加が期間として残る', () => {
    const r = foldParticipation(
      [
        jb(A, 1, [genesis()]),
        jb(A, 2, [invite(B)]),
        jb(B, 3, [accept()]),
        jb(B, 4, [resign()]),
        jb(A, 5, [invite(B)]),
        jb(B, 6, [accept()]),
      ],
      deps,
    );
    expect(r.history.get(B)).toEqual([{ from: 3, to: 4 }, { from: 6 }]);
  });

  test('非参加期間の判定 — Phase 2 の同期フィルタが使う', () => {
    const r = foldParticipation(
      [
        jb(A, 1, [genesis()]),
        jb(A, 2, [invite(B)]),
        jb(B, 3, [accept()]),
        jb(B, 4, [resign()]),
      ],
      deps,
    );
    expect(wasParticipatingAt(r, B, 2)).toBe(false); // 参加前
    expect(wasParticipatingAt(r, B, 3)).toBe(true); // 始点は含む
    expect(wasParticipatingAt(r, B, 4)).toBe(false); // 終点は含まない
    expect(wasParticipatingAt(r, C, 3)).toBe(false); // 一度も参加していない
  });
});

// --- 性質 (CLAUDE.md「全称命題は性質として書く」) ---

/** actor は 3 人の小さなプールから引く。広く振ると同じ相手への invite/revoke が並ばない */
const did = fc.constantFrom(A, B, C);
const opArb: fc.Arbitrary<JudgmentOp> = fc.oneof(
  fc.constant(genesis()),
  did.map(invite),
  fc.constant(accept()),
  fc.constant(resign()),
  did.map(revoke),
);
const batchArb = fc
  .tuple(
    did,
    fc.integer({ min: 0, max: 12 }),
    fc.array(opArb, { minLength: 1, maxLength: 2 }),
  )
  .map(([d, clock, ops]) => jb(d, clock, ops));
const logArb = fc.array(batchArb, { maxLength: 10 });

const same = (
  x: ReturnType<typeof foldParticipation>,
  y: ReturnType<typeof foldParticipation>,
) => {
  expect([...x.participating].sort()).toEqual([...y.participating].sort());
  expect([...x.invited.entries()].sort()).toEqual(
    [...y.invited.entries()].sort(),
  );
  expect([...x.history.entries()].sort()).toEqual(
    [...y.history.entries()].sort(),
  );
};

describe('性質', () => {
  test('∀ 配送順. 同じ op 集合を畳めば同じ名簿になる', () => {
    // これが「誰の手元でも同じ結論」の本体である。手元によって受信順は違うので、
    // 例で書いてもある 1 つの順序を確かめたことにしかならない
    fc.assert(
      fc.property(logArb, fc.integer(), (log, seed) => {
        const shuffled = [...log].sort(
          (a, b) => ((a.clock * 31 + seed) % 7) - ((b.clock * 31 + seed) % 7),
        );
        same(
          foldParticipation(log, deps),
          foldParticipation(shuffled.reverse(), deps),
        );
      }),
    );
  });

  test('∀ op 列. 捨てられた op を取り除いてから畳んでも結果は同じ', () => {
    // `rejected` の健全性。捨てた op に副作用が残っていたらここで落ちる
    fc.assert(
      fc.property(logArb, (log) => {
        const first = foldParticipation(log, deps);
        // **位置で取り除く。**同じ内容の op が 1 つの batch に 2 つ並ぶことがあり、
        // その一方だけが捨てられる (`[resign, resign]`)。内容で引くと両方消えてしまう
        const dropped = new Set(
          first.rejected.map((r) => `${r.batchId}:${r.opIndex}`),
        );
        const pruned = log
          .map((b) => ({
            ...b,
            ops: b.ops.filter((_, i) => !dropped.has(`${b.id}:${i}`)),
          }))
          .filter((b) => b.ops.length > 0);

        const second = foldParticipation(pruned, deps);
        same(first, second);
        expect(second.rejected).toEqual([]);
      }),
    );
  });
});
