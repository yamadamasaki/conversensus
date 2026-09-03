import { describe, expect, test } from 'bun:test';
import {
  type BatchId,
  type FileId,
  type JudgmentBatch,
  LamportClock,
} from '@conversensus/shared';
import {
  type AppendJudgmentDeps,
  appendJudgment,
  maxJudgmentClock,
} from './appendJudgment';

const FILE = '11111111-1111-4111-8111-111111111111' as FileId;
const ACTOR = 'did:plc:alice#dev-1';

let seq = 0;
const bid = () =>
  `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}` as BatchId;

const jb = (clock: number): JudgmentBatch => ({
  id: bid(),
  actor: ACTOR,
  clock,
  timestamp: 0,
  ops: [{ kind: 'participation.genesis' }],
});

function makeDeps(graphClock = new LamportClock()) {
  const written: JudgmentBatch[] = [];
  const deps: AppendJudgmentDeps = {
    clock: {
      seed: (floor) => {
        graphClock.seed(floor);
      },
      tick: () => graphClock.tick(),
    },
    actor: ACTOR,
    putJudgment: async (_fileId, batch) => {
      written.push(batch);
    },
    newBatchId: bid,
    now: () => 1_700_000_000_000,
  };
  return { deps, written, graphClock };
}

describe('maxJudgmentClock', () => {
  test('空なら 0 — genesis の clock がそこにいる', () => {
    expect(maxJudgmentClock([])).toBe(0);
  });

  test('最大値を返す', () => {
    expect(maxJudgmentClock([jb(3), jb(9), jb(1)])).toBe(9);
  });
});

describe('appendJudgment', () => {
  test('op をまとめて 1 つの batch にする — 判断は原子的である', async () => {
    const { deps, written } = makeDeps();
    await appendJudgment(
      deps,
      FILE,
      [
        { kind: 'participation.invite', target: 'did:plc:bob' },
        { kind: 'participation.revoke', target: 'did:plc:carol' },
      ],
      [],
    );
    expect(written).toHaveLength(1);
    expect(written[0]?.ops).toHaveLength(2);
  });

  test('op が空なら書かない', async () => {
    const { deps, written } = makeDeps();
    await expect(appendJudgment(deps, FILE, [], [])).rejects.toThrow();
    expect(written).toHaveLength(0);
  });

  test('グラフと同じ clock から発番する', async () => {
    // 独立した採番器を作ると、pre 条件の「より前」が壊れる
    const graphClock = new LamportClock();
    graphClock.seed(5); // グラフ側が clock 5 まで進んでいる
    const { deps, written } = makeDeps(graphClock);

    await appendJudgment(
      deps,
      FILE,
      [{ kind: 'participation.accept', inviter: 'did:plc:alice' }],
      [],
    );
    expect(written[0]?.clock).toBe(6);
  });

  test('判断ログの方が進んでいれば、そこまで引き上げてから発番する', async () => {
    // tap の clock はグラフの op-log の最大値から seed される。判断ログが先に
    // 進んでいると、引き上げないと同じ clock の batch が 2 つできる
    const graphClock = new LamportClock();
    graphClock.seed(3);
    const { deps, written } = makeDeps(graphClock);

    await appendJudgment(
      deps,
      FILE,
      [{ kind: 'participation.accept', inviter: 'did:plc:alice' }],
      [jb(1), jb(9)],
    );
    expect(written[0]?.clock).toBe(10);
  });

  test('グラフの方が進んでいれば引き下げない', async () => {
    // seed は下限の引き上げなので、既に大きい値には影響しない
    const graphClock = new LamportClock();
    graphClock.seed(20);
    const { deps, written } = makeDeps(graphClock);

    await appendJudgment(
      deps,
      FILE,
      [{ kind: 'participation.accept', inviter: 'did:plc:alice' }],
      [jb(2)],
    );
    expect(written[0]?.clock).toBe(21);
  });

  test('連続して書くと clock が単調に増える', async () => {
    const { deps, written } = makeDeps();
    await appendJudgment(
      deps,
      FILE,
      [{ kind: 'participation.accept', inviter: 'did:plc:alice' }],
      [],
    );
    await appendJudgment(
      deps,
      FILE,
      [{ kind: 'participation.resign' }],
      written,
    );
    expect(written.map((b) => b.clock)).toEqual([1, 2]);
  });
});
