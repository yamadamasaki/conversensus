import { describe, expect, test } from 'bun:test';
import {
  type BatchId,
  CausalClock,
  type FileId,
  type JudgmentBatch,
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
  seq: clock,
  deps: {},
  timestamp: 0,
  ops: [{ kind: 'participation.genesis' }],
});

function makeDeps(graphClock = new CausalClock(ACTOR)) {
  const written: JudgmentBatch[] = [];
  const deps: AppendJudgmentDeps = {
    // File の発番器 (グラフと共有)。本番では置き場の発番器をローカルの op-log から復元して返す
    clockFor: async () => graphClock,
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
    const graphClock = new CausalClock(ACTOR);
    graphClock.seedClock(5); // グラフ側が clock 5 まで進んでいる
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
    const graphClock = new CausalClock(ACTOR);
    graphClock.seedClock(3);
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
    const graphClock = new CausalClock(ACTOR);
    graphClock.seedClock(20);
    const { deps, written } = makeDeps(graphClock);

    await appendJudgment(
      deps,
      FILE,
      [{ kind: 'participation.accept', inviter: 'did:plc:alice' }],
      [jb(2)],
    );
    expect(written[0]?.clock).toBe(21);
  });

  describe('⚠️ その File がまだ手元に無いとき (2026-09-05 実機で発覚)', () => {
    // 承認する時点でその File は手元に無い。**開いている別の File の発番器を使ってはならない**
    // (別の clock 空間)。今は File ごとの発番器を借り、ローカルの op-log から復元する (#261) —
    // 手元に何も無ければ復元するものが無く、判断ログの最大値 + 1 で振る
    const makeTaplessDeps = () => {
      const written: JudgmentBatch[] = [];
      const deps: AppendJudgmentDeps = {
        clockFor: async () => new CausalClock(ACTOR),
        actor: ACTOR,
        putJudgment: async (_fileId, batch) => {
          written.push(batch);
        },
        newBatchId: bid,
        now: () => 1_700_000_000_000,
      };
      return { deps, written };
    };

    test('判断ログの最大値 + 1 で発番する', async () => {
      const { deps, written } = makeTaplessDeps();
      await appendJudgment(
        deps,
        FILE,
        [{ kind: 'participation.accept', inviter: 'did:plc:alice' }],
        [jb(7)],
      );
      // 依頼の clock は依頼者の tap がグラフを追い越して振ったものなので、
      // その + 1 は「依頼より後」を正しく表す
      expect(written[0]?.clock).toBe(8);
    });

    test('判断ログが空でも書ける (clock は 1 から)', async () => {
      const { deps, written } = makeTaplessDeps();
      await appendJudgment(
        deps,
        FILE,
        [{ kind: 'participation.accept', inviter: 'did:plc:alice' }],
        [],
      );
      expect(written[0]?.clock).toBe(1);
    });
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

describe('appendJudgment: 因果の点 (step3 Phase 1)', () => {
  test('グラフと同じ発番器で振るので、判断とグラフの seq は 1 本の連番になる', async () => {
    const graphClock = new CausalClock(ACTOR);
    // グラフ側で 2 つ書いた後
    graphClock.issue();
    graphClock.issue();
    const { deps, written } = makeDeps(graphClock);

    await appendJudgment(deps, FILE, [{ kind: 'participation.resign' }], []);

    expect(written[0]?.seq).toBe(3);
    // 次のグラフの点は判断の後になる
    expect(graphClock.issue().seq).toBe(4);
  });

  test('判断の deps は、書いた時点でグラフ側が知っていたものを含む', async () => {
    const graphClock = new CausalClock(ACTOR);
    graphClock.observe({
      actor: 'did:plc:bob#dev',
      seq: 5,
      deps: {},
      clock: 9,
    });
    const { deps, written } = makeDeps(graphClock);

    await appendJudgment(deps, FILE, [{ kind: 'participation.resign' }], []);

    expect(written[0]?.deps).toEqual({ 'did:plc:bob#dev': 5 });
  });
});

describe('appendJudgment: 同じ点を 2 度振らない (#261)', () => {
  test('窓 2: 開いていない File でも、ローカルのグラフの点の後から振る', async () => {
    // File の発番器を借りる側 (`judgmentClockFor`) がローカルの op-log から復元して返す。
    // 以前は判断ログだけから復元した使い捨ての発番器で振ったので、seq 1 を振り直していた
    const fileClock = new CausalClock(ACTOR);
    fileClock.restore([
      { actor: ACTOR, seq: 1, deps: {}, clock: 1 },
      { actor: ACTOR, seq: 2, deps: {}, clock: 2 },
    ]);
    const { deps, written } = makeDeps(fileClock);
    await appendJudgment(deps, FILE, [{ kind: 'participation.resign' }], []);
    expect(written[0]?.seq).toBe(3);
  });

  test('窓 1: 振った点を覚える (再読み込みの後の発番器の下限になる)', async () => {
    const remembered: { fileId: FileId; seq: number; clock: number }[] = [];
    const { deps, written } = makeDeps();
    await appendJudgment(
      {
        ...deps,
        rememberPoint: (fileId, point) =>
          remembered.push({ fileId, seq: point.seq, clock: point.clock }),
      },
      FILE,
      [{ kind: 'participation.resign' }],
      [],
    );
    expect(remembered).toEqual([
      {
        fileId: FILE,
        seq: written[0]?.seq ?? -1,
        clock: written[0]?.clock ?? -1,
      },
    ]);
  });
});
