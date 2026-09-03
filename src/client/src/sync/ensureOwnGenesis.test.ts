import { describe, expect, test } from 'bun:test';
import {
  type Actor,
  type Batch,
  type BatchId,
  type Did,
  type FileId,
  foldParticipation,
  type JudgmentBatch,
  type NodeId,
} from '@conversensus/shared';
import {
  type EnsureOwnGenesisDeps,
  ensureOwnGenesis,
  hasGenesis,
} from './ensureOwnGenesis';

const ALICE = 'did:plc:alice' as Did;
const BOB = 'did:plc:bob' as Did;
const ACTOR = `${ALICE}#dev-1` as Actor;
const F1 = '11111111-1111-4111-8111-111111111111' as FileId;

let seq = 0;
const bid = () =>
  `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}` as BatchId;

/** グラフの batch (所有の判定にしか使わないので op の中身は問わない) */
const gb = (actor: string): Batch => ({
  id: bid(),
  actor,
  clock: 1,
  timestamp: 0,
  ops: [{ kind: 'node.add', target: 'n1' as NodeId, content: 'x' }],
});

const invite = (actor: Actor, clock: number, target: Did): JudgmentBatch => ({
  id: bid(),
  actor,
  clock,
  timestamp: 0,
  ops: [{ kind: 'participation.invite', target }],
});

function makeDeps(over: Partial<EnsureOwnGenesisDeps> = {}) {
  const written: JudgmentBatch[] = [];
  const deps: EnsureOwnGenesisDeps = {
    fetchBatches: async () => [gb(ACTOR)],
    putJudgment: async (_fileId, batch) => {
      written.push(batch);
    },
    actor: ACTOR,
    ...over,
  };
  return { deps, written };
}

describe('hasGenesis', () => {
  test('起点が 1 つでもあれば true', () => {
    const genesis: JudgmentBatch = {
      id: bid(),
      actor: ACTOR,
      clock: 0,
      timestamp: 0,
      ops: [{ kind: 'participation.genesis' }],
    };
    expect(hasGenesis([invite(ACTOR, 5, BOB), genesis])).toBe(true);
  });

  test('招待だけなら起点は無い', () => {
    expect(hasGenesis([invite(ACTOR, 5, BOB)])).toBe(false);
  });

  test('判断ログが空なら起点は無い', () => {
    expect(hasGenesis([])).toBe(false);
  });
});

describe('ensureOwnGenesis', () => {
  test('起点が既にあれば何も書かない', async () => {
    const { deps, written } = makeDeps();
    const genesis: JudgmentBatch = {
      id: bid(),
      actor: ACTOR,
      clock: 0,
      timestamp: 0,
      ops: [{ kind: 'participation.genesis' }],
    };
    expect(await ensureOwnGenesis(deps, F1, [genesis])).toBe(false);
    expect(written).toEqual([]);
  });

  test('起点が無く自分の File なら置く', async () => {
    const { deps, written } = makeDeps();
    expect(await ensureOwnGenesis(deps, F1, [])).toBe(true);
    expect(written).toHaveLength(1);
    expect(written[0]?.ops).toEqual([{ kind: 'participation.genesis' }]);
    expect(written[0]?.actor).toBe(ACTOR);
  });

  test('他人の op がある File には置かない', async () => {
    // 起点は「この File を作ったのは自分だ」という主張である。
    // 確かめずに書くと、他人の File を自分のものだと宣言してしまう
    const { deps, written } = makeDeps({
      fetchBatches: async () => [gb(ACTOR), gb(`${BOB}#dev-9`)],
    });
    expect(await ensureOwnGenesis(deps, F1, [])).toBe(false);
    expect(written).toEqual([]);
  });

  test('べき等 — 2 度呼んでも同じ id に収束する', async () => {
    const { deps, written } = makeDeps();
    await ensureOwnGenesis(deps, F1, []);
    await ensureOwnGenesis(deps, F1, []);
    expect(written).toHaveLength(2);
    // rkey は id から決まるので、同じ id なら同じレコードに上書きされる
    expect(written[0]?.id).toBe(written[1]?.id as BatchId);
  });

  test('後から置いた起点は、それまでの招待を有効にする', async () => {
    // これが「後から置ける」ことの意味である。genesis の clock は 0 に固定されて
    // いて誰にも割り当てられないので、**既に書かれた招待より必ず前に来る**。
    // 実際に dev 環境で起きた形 (2026-09-03): 起点の無い File に招待が 3 件
    const known = [
      invite(ACTOR, 6, BOB),
      invite(ACTOR, 7, BOB),
      invite(ACTOR, 8, BOB),
    ];
    const before = foldParticipation(known, { isLocalDid: () => true });
    expect(before.invited.size).toBe(0);
    expect(before.rejected.map((r) => r.reason)).toEqual([
      'issuerNotParticipating',
      'issuerNotParticipating',
      'issuerNotParticipating',
    ]);

    const { deps, written } = makeDeps();
    expect(await ensureOwnGenesis(deps, F1, known)).toBe(true);

    const after = foldParticipation([...known, ...written], {
      isLocalDid: () => true,
    });
    expect(after.participating.has(ALICE)).toBe(true);
    expect(after.invited.get(BOB)).toBe(ALICE);
    expect(after.rejected).toEqual([]);
  });
});
