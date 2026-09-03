import { describe, expect, test } from 'bun:test';
import {
  type Batch,
  type BatchId,
  type FileId,
  foldParticipation,
  GENESIS_ACTOR,
  type JudgmentBatch,
  type NodeId,
} from '@conversensus/shared';
import {
  type BootstrapParticipationDeps,
  bootstrapParticipation,
  isSolelyOwnedBy,
} from './bootstrapParticipation';

const ALICE = 'did:plc:alice';
const BOB = 'did:plc:bob';
const ACTOR = `${ALICE}#dev-1`;
const F1 = '11111111-1111-4111-8111-111111111111' as FileId;
const F2 = '22222222-2222-4222-8222-222222222222' as FileId;

let seq = 0;
const bid = () =>
  `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}` as BatchId;

const gb = (actor: string, ops: Batch['ops'] = []): Batch => ({
  id: bid(),
  actor,
  clock: 1,
  timestamp: 0,
  ops: ops.length
    ? ops
    : ([
        { kind: 'node.add', target: 'n1' as NodeId, content: 'x' },
      ] as Batch['ops']),
});

type Written = { fileId: FileId; batch: JudgmentBatch };

function makeDeps(over: Partial<BootstrapParticipationDeps> = {}) {
  const written: Written[] = [];
  let marked = false;
  const deps: BootstrapParticipationDeps = {
    listLocalFileIds: async () => [F1],
    fetchBatches: async () => [gb(ACTOR)],
    listJudgmentFileIds: async () => [],
    putJudgment: async (fileId, batch) => {
      written.push({ fileId, batch });
    },
    actor: ACTOR,
    hasBootstrapped: () => marked,
    markBootstrapped: () => {
      marked = true;
    },
    ...over,
  };
  return { deps, written, isMarked: () => marked };
}

describe('isSolelyOwnedBy — 起点は「誰が作ったか」の主張である', () => {
  test('自分の op だけなら自分の File である', () => {
    expect(isSolelyOwnedBy([gb(ACTOR), gb(`${ALICE}#dev-2`)], ALICE)).toBe(
      true,
    );
  });

  test('ログイン前に作った File も自分のものである', () => {
    // `local#<deviceId>` は自分の端末で自分が作ったものに他ならない
    expect(isSolelyOwnedBy([gb('local#dev-1')], ALICE)).toBe(true);
  });

  test('genesis actor の batch は判定を妨げない', () => {
    expect(isSolelyOwnedBy([gb(GENESIS_ACTOR), gb(ACTOR)], ALICE)).toBe(true);
  });

  test('他人の op が 1 件でもあれば自分の File ではない', () => {
    expect(isSolelyOwnedBy([gb(ACTOR), gb(`${BOB}#dev-9`)], ALICE)).toBe(false);
  });

  test('op-log が空なら自分の File として扱う', () => {
    expect(isSolelyOwnedBy([], ALICE)).toBe(true);
  });
});

describe('bootstrapParticipation', () => {
  test('判断ログの無い自分の File に genesis を書く', async () => {
    const { deps, written, isMarked } = makeDeps();
    const result = await bootstrapParticipation(deps);

    expect(result).toMatchObject({ status: 'done', wrote: 1 });
    expect(written).toHaveLength(1);
    expect(written[0]?.fileId).toBe(F1);
    expect(written[0]?.batch.ops).toEqual([{ kind: 'participation.genesis' }]);
    expect(isMarked()).toBe(true);
  });

  test('書いた genesis を畳むと、その actor が最初の参加者になる', async () => {
    // bootstrap の目的そのもの。ここが繋がっていないと最初の招待が pre 条件で落ちる
    const { deps, written } = makeDeps();
    await bootstrapParticipation(deps);

    const roster = foldParticipation(
      written.map((w) => w.batch),
      { isLocalDid: () => true },
    );
    expect([...roster.participating]).toEqual([ALICE]);
    expect(roster.rejected).toEqual([]);
  });

  test('clock 0 で書く — あらゆるグラフ op より前である', async () => {
    // 後の clock を与えると、その actor 自身の過去の op が参加期間の外に落ちる
    const { deps, written } = makeDeps();
    await bootstrapParticipation(deps);
    expect(written[0]?.batch.clock).toBe(0);
  });

  test('既に判断ログがある File は触らない', async () => {
    const { deps, written } = makeDeps({
      listJudgmentFileIds: async () => [F1],
    });
    const result = await bootstrapParticipation(deps);

    expect(result).toMatchObject({
      status: 'done',
      wrote: 0,
      skippedExisting: 1,
    });
    expect(written).toHaveLength(0);
  });

  test('他人の op を含む File には書かない', async () => {
    // Phase 2 で他 actor の File がローカルに現れた後にこの移行が走っても、
    // 他人の File を自分のものだと宣言しない
    const { deps, written } = makeDeps({
      fetchBatches: async () => [gb(ACTOR), gb(`${BOB}#dev-9`)],
    });
    const result = await bootstrapParticipation(deps);

    expect(result).toMatchObject({
      status: 'done',
      wrote: 0,
      skippedForeign: 1,
    });
    expect(written).toHaveLength(0);
  });

  test('削除済みの File には書かない', async () => {
    const { deps, written } = makeDeps({
      fetchBatches: async () => [
        gb(ACTOR, [{ kind: 'file.remove' }] as Batch['ops']),
      ],
    });
    const result = await bootstrapParticipation(deps);

    expect(result).toMatchObject({
      status: 'done',
      wrote: 0,
      skippedDeleted: 1,
    });
    expect(written).toHaveLength(0);
  });

  test('marker が立っていれば何もしない', async () => {
    const { deps, written } = makeDeps({ hasBootstrapped: () => true });
    expect(await bootstrapParticipation(deps)).toEqual({
      status: 'already-bootstrapped',
    });
    expect(written).toHaveLength(0);
  });

  test('2 度走らせても同じ id になる — marker が無くてもゴミが増えない', async () => {
    // rkey は batch の id から決まるので、id が乱数だとレコードが 2 つになる。
    // marker は「毎回 N 回読みに行かない」ためのものであって正しさの前提ではない
    const first = makeDeps();
    await bootstrapParticipation(first.deps);
    const second = makeDeps();
    await bootstrapParticipation(second.deps);

    expect(second.written[0]?.batch.id).toBe(
      first.written[0]?.batch.id as BatchId,
    );
  });

  test('複数の File をまとめて処理する', async () => {
    const { deps, written } = makeDeps({
      listLocalFileIds: async () => [F1, F2],
      fetchBatches: async (fileId) =>
        fileId === F2 ? [gb(`${BOB}#dev-9`)] : [gb(ACTOR)],
    });
    const result = await bootstrapParticipation(deps);

    expect(result).toMatchObject({ wrote: 1, skippedForeign: 1 });
    expect(written.map((w) => w.fileId)).toEqual([F1]);
  });
});
