import { describe, expect, it } from 'bun:test';
import type {
  Batch,
  CausalPoint,
  Did,
  NodeId,
  Op,
  Participation,
  ParticipationEvent,
  VersionVector,
} from '@conversensus/shared';
import { GENESIS_ACTOR } from '@conversensus/shared';
import {
  filterByParticipation,
  isWithinParticipation,
} from './participationFilter';

const ALICE = 'did:plc:alice' as Did;
const BOB = 'did:plc:bob' as Did;

const addNode = (id: string): Op => ({
  kind: 'node.add',
  target: id as NodeId,
  content: 'ノード',
});

/**
 * グラフの batch。clock は既定で seq と同じにする。**期間の判定は clock を見ない**ことを
 * 示すテストだけが clock を別に与える
 */
const batch = (
  actor: string,
  seq: number,
  { deps = {}, clock = seq }: { deps?: VersionVector; clock?: number } = {},
): Batch => ({
  id: `b${seq}` as Batch['id'],
  actor,
  clock,
  seq,
  deps,
  timestamp: 1_700_000_000_000 + clock,
  ops: [addNode(`n${seq}`)],
});

/** 判断 batch の因果の点 */
const pt = (
  actor: string,
  seq: number,
  deps: VersionVector = {},
): CausalPoint => ({
  actor,
  seq,
  deps,
});

/** 名簿の出来事。clock は点の seq と同じにしておく (判定には使わない) */
const event = (
  kind: ParticipationEvent['kind'],
  point: CausalPoint,
): ParticipationEvent => ({
  kind,
  clock: point.seq,
  timestamp: point.seq,
  by: point.actor as Did,
  point,
});

/** 出来事の列だけを与える。期間は `periodsOf` が導く (畳み込みと同じ道を通す) */
const roster = (history: Record<string, ParticipationEvent[]>): Participation =>
  ({
    participating: new Set(Object.keys(history) as Did[]),
    invited: new Map(),
    departed: new Map(),
    history: new Map(Object.entries(history) as [Did, ParticipationEvent[]][]),
    rejected: [],
  }) satisfies Participation;

/** alice が自分で承認した (seq 10) */
const accepted = () => roster({ [ALICE]: [event('accept', pt(ALICE, 10))] });

/** alice が承認し (10)、bob が alice の seq 19 までを見た上で取り消した */
const revokedAfterSeeing19 = () =>
  roster({
    [ALICE]: [
      event('accept', pt(ALICE, 10)),
      event('revoke', pt(BOB, 20, { [ALICE]: 19 })),
    ],
  });

describe('isWithinParticipation', () => {
  it('期間を開いた判断の後に書かれた batch は通す', () => {
    expect(isWithinParticipation(accepted(), batch(ALICE, 11))).toBe(true);
    expect(isWithinParticipation(accepted(), batch(ALICE, 99))).toBe(true);
  });

  it('参加より前の batch は落とす', () => {
    expect(isWithinParticipation(accepted(), batch(ALICE, 9))).toBe(false);
  });

  it('取り消した人が見ていた batch は通し、見ていなかったものは落とす (完了基準 3 の観測点)', () => {
    const p = revokedAfterSeeing19();
    expect(isWithinParticipation(p, batch(ALICE, 19))).toBe(true);
    expect(isWithinParticipation(p, batch(ALICE, 20))).toBe(false);
    expect(isWithinParticipation(p, batch(ALICE, 21))).toBe(false);
  });

  /**
   * step3-entry §2.1 の 4 つ目の限界。step2 は期間を clock の区間 (`from <= clock < to`) で
   * 判定していたので、**取り消した人の clock と、取り消された人の batch の clock**という
   * 別の actor の clock どうしを比べていた。下の 2 件は、clock で判定すると答えが逆になる
   */
  it('🔴 取り消した人が見ていたなら、clock が取り消しより大きくても通す', () => {
    // alice の端末は clock が進んでいた (50)。bob はそれを受け取った上で、自分の clock 30 で
    // 取り消した。clock の区間なら 50 >= 30 で落ちる
    const p = roster({
      [ALICE]: [
        event('accept', pt(ALICE, 10)),
        event('revoke', pt(BOB, 30, { [ALICE]: 12 })),
      ],
    });
    expect(isWithinParticipation(p, batch(ALICE, 12, { clock: 50 }))).toBe(
      true,
    );
  });

  it('🔴 取り消した人が見ていなかったなら、clock が取り消しより小さくても落とす', () => {
    // alice は取り消しを知らずに書き続けた (seq 13)。clock は 15 で取り消し (30) より小さい。
    // clock の区間なら 15 < 30 で通ってしまう — 取り消された人の編集が、誰の手元でも残る
    const p = roster({
      [ALICE]: [
        event('accept', pt(ALICE, 10)),
        event('revoke', pt(BOB, 30, { [ALICE]: 12 })),
      ],
    });
    expect(isWithinParticipation(p, batch(ALICE, 13, { clock: 15 }))).toBe(
      false,
    );
  });

  it('自分で辞めたなら、辞める前の自分の編集がちょうど入る', () => {
    // 辞退は自分の点なので、同じ actor の seq で切れる
    const p = roster({
      [ALICE]: [event('accept', pt(ALICE, 10)), event('resign', pt(ALICE, 20))],
    });
    expect(isWithinParticipation(p, batch(ALICE, 19))).toBe(true);
    expect(isWithinParticipation(p, batch(ALICE, 21))).toBe(false);
  });

  it('再参加した後の batch は通し、間の期間は落とす', () => {
    const p = roster({
      [ALICE]: [
        event('accept', pt(ALICE, 10)),
        event('revoke', pt(BOB, 20, { [ALICE]: 19 })),
        event('invite', pt(BOB, 25, { [ALICE]: 19 })),
        event('accept', pt(ALICE, 30, { [BOB]: 25 })),
      ],
    });
    expect(isWithinParticipation(p, batch(ALICE, 15))).toBe(true);
    expect(isWithinParticipation(p, batch(ALICE, 25))).toBe(false); // 非参加の谷
    expect(isWithinParticipation(p, batch(ALICE, 31))).toBe(true);
  });

  it('名簿にいない DID の batch は落とす', () => {
    expect(isWithinParticipation(accepted(), batch(BOB, 15))).toBe(false);
  });

  it('判定は `<did>#<deviceId>` の DID 部分で行う', () => {
    // 相手の端末が増えても名簿は DID 単位である。2 台目は承認を受け取ってから書いた
    const seen = { deps: { [ALICE]: 10 } };
    expect(
      isWithinParticipation(accepted(), batch(`${ALICE}#device-2`, 15, seen)),
    ).toBe(true);
    expect(
      isWithinParticipation(accepted(), batch(`${BOB}#device-2`, 15, seen)),
    ).toBe(false);
  });

  it('別端末で承認を受け取る前に書いた batch は落とす', () => {
    // 同じ人でも、承認が見えていない端末の編集は参加してから書いたものではない
    expect(
      isWithinParticipation(accepted(), batch(`${ALICE}#device-2`, 15)),
    ).toBe(false);
  });

  it('merge の写しは merge した人の期間で判定する (写しは merge した人の batch)', () => {
    // bob が書いた branch を、bob の離脱後に alice が merge した。写しは alice 自身の batch
    // なので (step3 Phase 1 D2)、actor で判定すれば alice の期間になり、取り込みは落ちない
    const p = roster({
      [ALICE]: [event('accept', pt(`${ALICE}#dev-a`, 10))],
      [BOB]: [
        event('accept', pt(`${BOB}#dev-b`, 10)),
        event('revoke', pt(`${ALICE}#dev-a`, 20, { [`${BOB}#dev-b`]: 10 })),
      ],
    });
    const mergedByAlice = {
      ...batch(`${ALICE}#dev-a`, 30),
      copyOf: { actor: `${BOB}#dev-b`, seq: 5 },
    };
    const mergedByBob = {
      ...batch(`${BOB}#dev-b`, 30),
      copyOf: { actor: `${ALICE}#dev-a`, seq: 5 },
    };
    expect(isWithinParticipation(p, mergedByAlice)).toBe(true);
    expect(isWithinParticipation(p, mergedByBob)).toBe(false);
  });

  it('genesis は期間を持たないが通す (File の起源)', () => {
    // 落とすと承認した側が起源を持たない op-log を畳むことになる
    expect(isWithinParticipation(accepted(), batch(GENESIS_ACTOR, 0))).toBe(
      true,
    );
    expect(isWithinParticipation(accepted(), batch(GENESIS_ACTOR, 99))).toBe(
      true,
    );
  });

  it('依頼されただけの actor の batch は落とす (期間が 1 つも開いていない)', () => {
    const p = roster({ [ALICE]: [event('invite', pt(BOB, 5))] });
    expect(isWithinParticipation(p, batch(ALICE, 6))).toBe(false);
  });
});

describe('filterByParticipation', () => {
  it('通る batch だけを入力順序を保って返す', () => {
    const out = filterByParticipation(revokedAfterSeeing19(), [
      batch(GENESIS_ACTOR, 0),
      batch(ALICE, 5),
      batch(ALICE, 15),
      batch(BOB, 15),
      batch(ALICE, 25),
    ]);
    expect(out.map((b) => b.seq)).toEqual([0, 15]);
  });

  it('空入力は空を返す', () => {
    expect(filterByParticipation(roster({}), [])).toEqual([]);
  });
});

describe('引き取り (reopen) の後に何が届くか — 実装の記録', () => {
  /**
   * alice が作り (1), bob に取り消され (bob は alice の 2 までを見ていた), 誰もいない間に
   * ローカルで編集し, 引き取って (9) また編集した状態。**期間は 2 つに分かれる**
   */
  const reopened = () =>
    roster({
      [ALICE]: [
        event('genesis', pt(ALICE, 1)),
        event('revoke', pt(BOB, 4, { [ALICE]: 2 })),
        event('reopen', pt(ALICE, 9)),
      ],
    });

  it('後から呼ばれた人には「止めた状態 + 引き取った後の変更」だけが届く', () => {
    // 空白期間 (6,7,8) の編集は `outside period` として落ちる。
    // 「引き取りは新しい期間を開くだけ」(仕様の決定) の観測点である
    const out = filterByParticipation(reopened(), [
      batch(ALICE, 2), // 参加中
      batch(ALICE, 6), // 誰もいない間
      batch(ALICE, 7),
      batch(ALICE, 8),
      batch(ALICE, 11), // 引き取った後
    ]);
    expect(out.map((b) => b.seq)).toEqual([2, 11]);
  });

  it('⚠️ 引き取った本人の手元は巻き戻らない', () => {
    // **このフィルタは自分の repo には適用されない** (モジュール冒頭の「⚠️ 自分の repo
    // には適用しない」)。引き取りは判断ログに op を 1 つ書くだけで、グラフの op-log に
    // 触らない。したがって本人の手元は今の状態のままで、**後から呼んだ人とは
    // projection が食い違う** — 意図した動作である。
    //
    // ここで固定するのは「かけたら何が落ちるか」であって、かける経路があることでは
    // ない。落ちる中身が変わったらこのテストが先に落ちる
    const mine = [2, 6, 7, 8, 11].map((s) => batch(ALICE, s));
    expect(filterByParticipation(reopened(), mine).map((b) => b.seq)).toEqual([
      2, 11,
    ]);
    // 本人の手元にはこの 5 件がすべて残る (呼び出し側がフィルタを通さないため)
    expect(mine.map((b) => b.seq)).toEqual([2, 6, 7, 8, 11]);
  });
});
