import { describe, expect, it } from 'bun:test';
import type {
  Batch,
  Did,
  NodeId,
  Op,
  Participation,
  ParticipationEvent,
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

const batch = (actor: string, clock: number): Batch => ({
  id: `b${clock}` as Batch['id'],
  actor,
  clock,
  timestamp: 1_700_000_000_000 + clock,
  ops: [addNode(`n${clock}`)],
});

const event = (
  kind: ParticipationEvent['kind'],
  clock: number,
): ParticipationEvent => ({ kind, clock, timestamp: clock, by: ALICE });

/** 出来事の列だけを与える。期間は `periodsOf` が導く (畳み込みと同じ道を通す) */
const roster = (history: Record<string, ParticipationEvent[]>): Participation =>
  ({
    participating: new Set(Object.keys(history) as Did[]),
    invited: new Map(),
    departed: new Map(),
    history: new Map(Object.entries(history) as [Did, ParticipationEvent[]][]),
    rejected: [],
  }) satisfies Participation;

describe('isWithinParticipation', () => {
  it('参加期間の中の batch は通す', () => {
    const p = roster({ [ALICE]: [event('accept', 10)] });
    expect(isWithinParticipation(p, batch(ALICE, 10))).toBe(true);
    expect(isWithinParticipation(p, batch(ALICE, 99))).toBe(true);
  });

  it('参加より前の batch は落とす', () => {
    const p = roster({ [ALICE]: [event('accept', 10)] });
    expect(isWithinParticipation(p, batch(ALICE, 9))).toBe(false);
  });

  it('取りやめた後の batch は落とす (完了基準 3 の観測点)', () => {
    const p = roster({ [ALICE]: [event('accept', 10), event('revoke', 20)] });
    expect(isWithinParticipation(p, batch(ALICE, 19))).toBe(true);
    // 終点は開いている: 取りやめた瞬間の clock は既に参加者でない
    expect(isWithinParticipation(p, batch(ALICE, 20))).toBe(false);
    expect(isWithinParticipation(p, batch(ALICE, 21))).toBe(false);
  });

  it('再参加した後の batch は通し、間の期間は落とす', () => {
    const p = roster({
      [ALICE]: [
        event('accept', 10),
        event('revoke', 20),
        event('invite', 25),
        event('accept', 30),
      ],
    });
    expect(isWithinParticipation(p, batch(ALICE, 15))).toBe(true);
    expect(isWithinParticipation(p, batch(ALICE, 25))).toBe(false); // 非参加の谷
    expect(isWithinParticipation(p, batch(ALICE, 30))).toBe(true);
  });

  it('名簿にいない DID の batch は落とす', () => {
    const p = roster({ [ALICE]: [event('accept', 10)] });
    expect(isWithinParticipation(p, batch(BOB, 15))).toBe(false);
  });

  it('判定は `<did>#<deviceId>` の DID 部分で行う', () => {
    // 相手の端末が増えても名簿は DID 単位である
    const p = roster({ [ALICE]: [event('accept', 10)] });
    expect(isWithinParticipation(p, batch(`${ALICE}#device-2`, 15))).toBe(true);
    expect(isWithinParticipation(p, batch(`${BOB}#device-2`, 15))).toBe(false);
  });

  it('genesis は期間を持たないが通す (File の起源)', () => {
    // 落とすと承認した側が起源を持たない op-log を畳むことになる
    const p = roster({ [ALICE]: [event('accept', 10)] });
    expect(isWithinParticipation(p, batch(GENESIS_ACTOR, 0))).toBe(true);
    expect(isWithinParticipation(p, batch(GENESIS_ACTOR, 99))).toBe(true);
  });

  it('依頼されただけの actor の batch は落とす (期間が 1 つも開いていない)', () => {
    const p = roster({ [ALICE]: [event('invite', 5)] });
    expect(isWithinParticipation(p, batch(ALICE, 6))).toBe(false);
  });
});

describe('filterByParticipation', () => {
  it('通る batch だけを入力順序を保って返す', () => {
    const p = roster({ [ALICE]: [event('accept', 10), event('revoke', 20)] });
    const out = filterByParticipation(p, [
      batch(GENESIS_ACTOR, 0),
      batch(ALICE, 5),
      batch(ALICE, 15),
      batch(BOB, 15),
      batch(ALICE, 25),
    ]);
    expect(out.map((b) => b.clock)).toEqual([0, 15]);
  });

  it('空入力は空を返す', () => {
    expect(filterByParticipation(roster({}), [])).toEqual([]);
  });
});

describe('引き取り (reopen) の後に何が届くか — 実装の記録', () => {
  /**
   * alice が作り (1), 取り消され (4), 誰もいない間にローカルで編集し, 引き取って (9)
   * また編集した状態。**期間は 2 つに分かれる**
   */
  const reopened = () =>
    roster({
      [ALICE]: [event('genesis', 1), event('revoke', 4), event('reopen', 9)],
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
    expect(out.map((b) => b.clock)).toEqual([2, 11]);
  });

  it('⚠️ 引き取った本人の手元は巻き戻らない', () => {
    // **このフィルタは自分の repo には適用されない** (モジュール冒頭の「⚠️ 自分の repo
    // には適用しない」)。引き取りは判断ログに op を 1 つ書くだけで、グラフの op-log に
    // 触らない。したがって本人の手元は今の状態のままで、**後から呼んだ人とは
    // projection が食い違う** — 意図した動作である。
    //
    // ここで固定するのは「かけたら何が落ちるか」であって、かける経路があることでは
    // ない。落ちる中身が変わったらこのテストが先に落ちる
    const mine = [2, 6, 7, 8, 11].map((c) => batch(ALICE, c));
    expect(filterByParticipation(reopened(), mine).map((b) => b.clock)).toEqual(
      [2, 11],
    );
    // 本人の手元にはこの 5 件がすべて残る (呼び出し側がフィルタを通さないため)
    expect(mine.map((b) => b.clock)).toEqual([2, 6, 7, 8, 11]);
  });
});
