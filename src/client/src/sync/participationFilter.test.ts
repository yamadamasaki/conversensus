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
