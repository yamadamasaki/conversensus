import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import type { JudgmentBatch, JudgmentOp } from './judgment';
import {
  findFounder,
  foldParticipation,
  hasEverParticipated,
  periodsOf,
  wasParticipatingIn,
} from './participation';
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
  /** 表示用の日時。順序付けには使わないので、既定は 0 でよい */
  timestamp = 0,
): JudgmentBatch => ({
  id: bid(),
  actor: `${did}#${device}`,
  clock,
  seq: clock,
  deps: {},
  timestamp,
  ops,
});

const genesis = (): JudgmentOp => ({ kind: 'participation.genesis' });
const invite = (target: string): JudgmentOp => ({
  kind: 'participation.invite',
  target,
});
const accept = (inviter = A): JudgmentOp => ({
  kind: 'participation.accept',
  inviter,
});
const resign = (): JudgmentOp => ({ kind: 'participation.resign' });
const revoke = (target: string): JudgmentOp => ({
  kind: 'participation.revoke',
  target,
});
const reopen = (): JudgmentOp => ({ kind: 'participation.reopen' });

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

  test('外れた理由を覚える — 外から見て revoke と resign は区別がつかない', () => {
    // 仕様の UI 一覧が revoked と resigned を別の状態として並べるので、
    // 畳み込みが覚えていなければ画面に出せない
    const r = foldParticipation(
      [
        jb(A, 1, [genesis()]),
        jb(A, 2, [invite(B)]),
        jb(B, 3, [accept()]),
        jb(A, 4, [invite(C)]),
        jb(C, 5, [accept()]),
        jb(A, 6, [revoke(B)]),
        jb(C, 7, [resign()]),
      ],
      deps,
    );
    expect(r.departed.get(B)).toBe('revoked');
    expect(r.departed.get(C)).toBe('resigned');
  });

  test('再参加すると外れた記録は消える — 履歴ではなく現在の状態である', () => {
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
    expect(r.departed.has(B)).toBe(false);
    expect([...r.participating].sort()).toEqual([A, B]);
    // 履歴の方には残る (期間は出来事から導く)
    expect(periodsOf(r, B).map(({ from, to }) => ({ from, to }))).toEqual([
      { from: 3, to: 4 },
      { from: 6, to: undefined },
    ]);
  });

  test('再招待された時点で「外れている」ではなくなる', () => {
    // 承認する前でも、招待中は revoked の表示ではなく sent であるべきである
    const r = foldParticipation(
      [
        jb(A, 1, [genesis()]),
        jb(A, 2, [invite(B)]),
        jb(A, 3, [revoke(B)]),
        jb(A, 4, [invite(B)]),
      ],
      deps,
    );
    expect(r.departed.has(B)).toBe(false);
    expect(r.invited.get(B)).toBe(A);
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
    expect(periodsOf(r, B).map(({ from, to }) => ({ from, to }))).toEqual([
      { from: 3, to: 4 },
      { from: 6, to: undefined },
    ]);
  });

  test('依頼のまま取り消された期間は開かない', () => {
    // 依頼は参加ではない。参加期間にならないが、**出来事としては残る** —
    // 参加履歴の「依頼取り止め」列がこれを出す
    const r = foldParticipation(
      [jb(A, 1, [genesis()]), jb(A, 2, [invite(B)]), jb(A, 3, [revoke(B)])],
      deps,
    );
    expect(periodsOf(r, B)).toEqual([]);
    expect(r.history.get(B)?.map((e) => e.kind)).toEqual(['invite', 'revoke']);
  });

  test('一度も参加していない人と, 依頼されただけの人を区別する', () => {
    // 仕様「依頼中に依頼が取り止められた場合, 今までに参加したことがなければ
    // 一覧に表示されない」がこの区別を要る。`history.has` では区別できない
    const r = foldParticipation(
      [jb(A, 1, [genesis()]), jb(A, 2, [invite(B)]), jb(A, 3, [revoke(B)])],
      deps,
    );
    expect(r.history.has(B)).toBe(true);
    expect(hasEverParticipated(r, B)).toBe(false);
    expect(hasEverParticipated(r, A)).toBe(true);
  });

  test('出来事は日時と実行者を持つ — 依頼と取り消しは対象と別人である', () => {
    const r = foldParticipation(
      [
        jb(A, 1, [genesis()], 'dev-1', 1000),
        jb(A, 2, [invite(B)], 'dev-1', 2000),
        jb(B, 3, [accept()], 'dev-1', 3000),
        jb(A, 4, [revoke(B)], 'dev-1', 4000),
      ],
      deps,
    );
    // 因果の点は「出来事は判断 batch の因果の点を持つ」で見る
    expect(
      r.history.get(B)?.map(({ kind, clock, timestamp, by }) => ({
        kind,
        clock,
        timestamp,
        by,
      })),
    ).toEqual([
      { kind: 'invite', clock: 2, timestamp: 2000, by: A },
      { kind: 'accept', clock: 3, timestamp: 3000, by: B },
      { kind: 'revoke', clock: 4, timestamp: 4000, by: A },
    ]);
  });

  test('捨てられた op は履歴に載らない', () => {
    // **生の batch から画面側で組んではならない**ことの根拠である。
    // C は参加していないので、その取り消しは pre 条件で捨てられる
    const r = foldParticipation(
      [jb(A, 1, [genesis()]), jb(A, 2, [invite(B)]), jb(C, 3, [revoke(B)])],
      deps,
    );
    expect(r.rejected.map((x) => x.reason)).toEqual(['issuerNotParticipating']);
    expect(r.history.get(B)?.map((e) => e.kind)).toEqual(['invite']);
  });

  test('非参加期間の判定 — Phase 2 の同期フィルタが使う (因果の点で判定する)', () => {
    const r = foldParticipation(
      [
        jb(A, 1, [genesis()]),
        jb(A, 2, [invite(B)]),
        jb(B, 3, [accept()]),
        jb(B, 6, [resign()]),
      ],
      deps,
    );
    // B の端末 (dev-1) のグラフの点。判断ログと連番を共有するので 3 と 6 は使われている
    const at = (seq: number) => ({ actor: `${B}#dev-1`, seq, deps: {} });
    expect(wasParticipatingIn(r, B, at(2))).toBe(false); // 承認より前
    expect(wasParticipatingIn(r, B, at(4))).toBe(true); // 承認の後、辞める前
    expect(wasParticipatingIn(r, B, at(7))).toBe(false); // 辞めた後
    expect(wasParticipatingIn(r, C, at(4))).toBe(false); // 一度も参加していない
  });

  test('出来事は判断 batch の因果の点を持つ', () => {
    const r = foldParticipation(
      [jb(A, 1, [genesis()]), jb(A, 2, [invite(B)])],
      deps,
    );
    expect(r.history.get(B)?.[0]?.point).toEqual({
      actor: `${A}#dev-1`,
      seq: 2,
      deps: {},
    });
  });
});

describe('引き取り — 誰も参加していない File を開き直す', () => {
  /** 最後の 1 人が降りて名簿が空になった状態 */
  const abandoned = () => [
    jb(A, 1, [genesis()]),
    jb(A, 2, [invite(B)]),
    jb(B, 3, [accept()]),
    jb(B, 4, [revoke(A)]),
    jb(B, 5, [resign()]),
  ];

  test('⚠️ 引き取りが無ければ行き止まりになる', () => {
    // **これが引き取りを足した理由である。**空の名簿からは招待が
    // `issuerNotParticipating` で, 起点の置き直しが `duplicateGenesis` で落ちる
    const p = foldParticipation(
      [...abandoned(), jb(A, 6, [invite(B)]), jb(A, 7, [genesis()])],
      deps,
    );
    expect(p.participating.size).toBe(0);
    expect(p.rejected.map((r) => r.reason)).toEqual([
      'issuerNotParticipating',
      'duplicateGenesis',
    ]);
  });

  test('名簿が空なら引き取れる', () => {
    const p = foldParticipation([...abandoned(), jb(A, 6, [reopen()])], deps);
    expect([...p.participating]).toEqual([A]);
    expect(p.departed.has(A)).toBe(false); // 「外れている」ではなくなる
  });

  test('作成者でなくても引き取れる', () => {
    // 仕様: 「誰も参加していない時には, ファイル作成者に限らない」。
    // 畳み込みは所属を見ない — 起点から辿れない repo はそもそも読まれないので、
    // 読まれる範囲では「判断ログに名前のある人」に自然に限られる
    const p = foldParticipation([...abandoned(), jb(B, 6, [reopen()])], deps);
    expect([...p.participating]).toEqual([B]);
  });

  test('引き取った人はそのまま招待できる', () => {
    const p = foldParticipation(
      [...abandoned(), jb(A, 6, [reopen()]), jb(A, 7, [invite(B)])],
      deps,
    );
    expect(p.invited.get(B)).toBe(A);
  });

  test('誰かが参加していれば引き取れない', () => {
    const p = foldParticipation(
      [jb(A, 1, [genesis()]), jb(B, 2, [reopen()])],
      deps,
    );
    expect([...p.participating]).toEqual([A]);
    expect(p.rejected.map((r) => r.reason)).toEqual(['rosterNotEmpty']);
  });

  test('起点が無ければ引き取れない', () => {
    // 起点の無い File には「引き取る名簿」がそもそも無い。これは
    // `ensureOwnGenesis` が直す別の状態で、混ぜると起点の修復が 2 通りになる
    const p = foldParticipation([jb(A, 1, [reopen()])], deps);
    expect(p.participating.size).toBe(0);
    expect(p.rejected.map((r) => r.reason)).toEqual(['noGenesis']);
  });

  test('同時に 2 人が引き取っても, 通るのは 1 人だけ', () => {
    // clock 順で先の 1 人が入り、後の 1 人は名簿が空でなくなっているので落ちる。
    // **誰の手元でも同じ結論になる**ことがここの要点である
    const p = foldParticipation(
      [...abandoned(), jb(A, 6, [reopen()]), jb(B, 7, [reopen()])],
      deps,
    );
    expect([...p.participating]).toEqual([A]);
    expect(p.rejected.map((r) => r.reason)).toEqual(['rosterNotEmpty']);
  });

  test('⚠️ 引き取りは新しい期間を開くだけ — 誰もいなかった間は含めない', () => {
    // 仕様の決定 (2026-09-05)。遡って開くと「取り消した後の操作は反映されない」を
    // 名簿を空にする経路で迂回できてしまう
    const p = foldParticipation([...abandoned(), jb(A, 9, [reopen()])], deps);
    expect(periodsOf(p, A).map(({ from, to }) => ({ from, to }))).toEqual([
      { from: 1, to: 4 },
      { from: 9, to: undefined },
    ]);
    const at = (seq: number) => ({ actor: `${A}#dev-1`, seq, deps: {} });
    expect(wasParticipatingIn(p, A, at(6))).toBe(false); // 空だった間
    expect(wasParticipatingIn(p, A, at(10))).toBe(true); // 引き取った後
  });

  test('引き取りは参加歴になる', () => {
    // 一度も参加していない人は一覧に出ない (仕様) ので、これが false だと
    // 引き取った本人が名簿から消える
    const p = foldParticipation([...abandoned(), jb(A, 6, [reopen()])], deps);
    expect(hasEverParticipated(p, A)).toBe(true);
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
  // **引き取りも引く。**性質 2 つ (配送順の不変性 / 捨てた op の無副作用) は
  // op の種類ごとに書き直すものではない。生成器に入れないと, 新しい op だけが
  // 全称命題の外に残る
  fc.constant(reopen()),
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
  expect([...x.departed.entries()].sort()).toEqual(
    [...y.departed.entries()].sort(),
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

describe('創設者 (security review H2)', () => {
  // A が File を作り B を招待、B が C を招待。M は A に招待された参加者で、偽の起点も書いた
  // 攻撃者は名前を選べる: 本物より前に並ぶ DID にする
  const M = 'did:plc:aaamallory';
  const log = [
    jb(A, 0, [genesis()]),
    jb(A, 1, [invite(B)]),
    jb(B, 2, [accept(A)]),
    jb(B, 3, [invite(C)]),
    jb(C, 4, [accept(B)]),
  ];

  test('起点から招待の鎖を辿って、承認を持たず起点を書いた人に着く', () => {
    expect(findFounder(log, C)).toBe(A);
    expect(findFounder(log, B)).toBe(A);
    expect(findFounder(log, A)).toBe(A);
  });

  test('承認を持つ人が偽の起点を書いても、鎖は招待した人へ進むので創設者にならない', () => {
    const withM = [
      ...log,
      jb(A, 5, [invite(M)]),
      jb(M, 6, [accept(A)]),
      // 偽の起点: 本物と同じ clock、actor の文字列も前に来るよう選べる
      jb(M, 0, [genesis()], '0'),
    ];
    expect(findFounder(withM, M)).toBe(A);
  });

  test('鎖の先が読めていなければ分からない (null)', () => {
    expect(findFounder([jb(C, 4, [accept(B)])], C)).toBeNull();
  });

  test('創設者が抜けて招待し直されて戻ると鎖は輪になるが、輪の中で起点を書いた人が創設者', () => {
    const rejoined = [
      ...log,
      jb(A, 5, [resign()]),
      jb(B, 6, [invite(A)]),
      jb(A, 7, [accept(B)]),
    ];
    expect(findFounder(rejoined, C)).toBe(A);
    expect(findFounder(rejoined, A)).toBe(A);
  });

  test('創設者を渡すと、それ以外の起点は notFounder で捨てられ、名簿を乗っ取れない', () => {
    const forged = [
      // 偽の起点が本物より先に並ぶ (同じ clock、actor が前)
      jb(M, 0, [genesis()], '0'),
      ...log,
    ];
    const without = foldParticipation(forged, deps);
    // 創設者を渡さない (従来) と、先に並んだ偽の起点が採られて A は名簿から落ちる
    expect(without.participating.has(A)).toBe(false);

    const r = foldParticipation(forged, { ...deps, founder: A });
    expect(r.founder).toBe(A);
    expect([...r.participating].sort()).toEqual([A, B, C].sort());
    expect(reasons(r)).toContain('notFounder');
  });

  test('創設者が分からない (null) ときは、どの起点も採らない', () => {
    const r = foldParticipation(log, { ...deps, founder: null });
    expect(r.participating.size).toBe(0);
    expect(r.founder).toBeUndefined();
  });
});
