import { describe, expect, test } from 'bun:test';
import { type Actor, CausalClock, type FileId } from '@conversensus/shared';
import fc from 'fast-check';
import { FileSessionPool, type SessionFactory } from './fileSessionPool';

const ACTOR = 'did:plc:alice#dev-a' as Actor;
const FILE_A = '00000000-0000-4000-8000-00000000000a' as FileId;
const FILE_B = '00000000-0000-4000-8000-00000000000b' as FileId;
const FILE_C = '00000000-0000-4000-8000-00000000000c' as FileId;

/** 作られたセッションの記録。start / stop の回数を数える */
type FakeSession = {
  fileId: FileId;
  causal: CausalClock;
  generation: number;
  starts: number;
  stops: number;
  start: () => () => void;
};

function recorder(generation = 1) {
  const made: FakeSession[] = [];
  const factory: SessionFactory<FakeSession> = (fileId, causal) => {
    const session: FakeSession = {
      fileId,
      causal,
      generation,
      starts: 0,
      stops: 0,
      start: () => {
        session.starts += 1;
        return () => {
          session.stops += 1;
        };
      },
    };
    made.push(session);
    return session;
  };
  return { made, factory };
}

function newPool() {
  return new FileSessionPool<FakeSession>(() => new CausalClock(ACTOR));
}

/** 1 拍遅れの停止を走らせる */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('FileSessionPool: 性質', () => {
  /**
   * File の小さなプール (3 つ) と持ち手 2 人 (前の view・背後のタブ)。広いと同じ File を
   * 2 人が持つ場面 (セッションを共有すべき場面) に当たらない
   */
  const arbHold = fc.record({
    holder: fc.constantFrom('front', 'background'),
    fileIds: fc.subarray([FILE_A, FILE_B, FILE_C]),
    release: fc.boolean(),
  });

  test('止まった後に生きているのは、誰かが持っている File のセッションちょうど 1 つずつ', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(arbHold, { maxLength: 12 }), async (steps) => {
        const pool = newPool();
        const { made, factory } = recorder();
        pool.setFactory(factory);
        const held = new Map<string, FileId[]>();
        for (const step of steps) {
          if (step.release) {
            pool.release(step.holder);
            held.delete(step.holder);
          } else {
            pool.hold(step.holder, step.fileIds);
            held.set(step.holder, step.fileIds);
          }
        }
        await tick();
        const expected = new Set([...held.values()].flat());
        const running = made.filter((s) => s.starts > s.stops);
        expect(new Set(running.map((s) => s.fileId))).toEqual(expected);
        // 同じ File のセッションが 2 つ走っていない
        expect(running).toHaveLength(expected.size);
        pool.dispose();
      }),
    );
  });

  test('同じ File の発番器は、セッションを作り直しても常に同じもの', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(arbHold, { maxLength: 12 }), async (steps) => {
        const pool = newPool();
        const { made, factory } = recorder();
        pool.setFactory(factory);
        for (const step of steps) {
          if (step.release) pool.release(step.holder);
          else pool.hold(step.holder, step.fileIds);
          await tick();
        }
        for (const s of made) expect(s.causal).toBe(pool.causalOf(s.fileId));
        pool.dispose();
      }),
    );
  });
});

describe('FileSessionPool: 例', () => {
  test('前の view と背後のタブが同じ File を持つと、セッションは 1 つ', () => {
    const pool = newPool();
    const { made, factory } = recorder();
    pool.setFactory(factory);
    pool.hold('front', [FILE_A]);
    pool.hold('background', [FILE_A, FILE_B]);
    expect(made.map((s) => s.fileId)).toEqual([FILE_A, FILE_B]);
    pool.dispose();
  });

  test('離してすぐ持ち直すと (StrictMode・タブの切り替え)、作り直さない', async () => {
    const pool = newPool();
    const { made, factory } = recorder();
    pool.setFactory(factory);
    pool.hold('front', [FILE_A]);
    pool.release('front');
    pool.hold('front', [FILE_A]);
    await tick();
    expect(made).toHaveLength(1);
    expect(made[0]?.stops).toBe(0);
    pool.dispose();
  });

  test('前と背後で File が入れ替わっても、作り直さない', async () => {
    const pool = newPool();
    const { made, factory } = recorder();
    pool.setFactory(factory);
    pool.hold('front', [FILE_A]);
    pool.hold('background', [FILE_B]);
    pool.hold('front', [FILE_B]);
    pool.hold('background', [FILE_A]);
    await tick();
    expect(made).toHaveLength(2);
    expect(made.every((s) => s.stops === 0)).toBe(true);
    pool.dispose();
  });

  test('誰も持たなくなった File のセッションは、1 拍遅れて止まる', async () => {
    const pool = newPool();
    const { made, factory } = recorder();
    pool.setFactory(factory);
    pool.hold('front', [FILE_A]);
    pool.release('front');
    expect(made[0]?.stops).toBe(0);
    await tick();
    expect(made[0]?.stops).toBe(1);
    expect(pool.session(FILE_A)).toBeUndefined();
    pool.dispose();
  });

  test('作り方を差し替えると生きているセッションを作り直し、発番器は引き継ぐ', () => {
    const pool = newPool();
    const first = recorder(1);
    pool.setFactory(first.factory);
    pool.hold('front', [FILE_A]);
    const second = recorder(2);
    pool.setFactory(second.factory);
    expect(first.made[0]?.stops).toBe(1);
    expect(pool.session(FILE_A)?.generation).toBe(2);
    expect(second.made[0]?.causal).toBe(first.made[0]?.causal);
    pool.dispose();
  });

  test('作り方が無いうちは作らず、渡された時に持たれている分を作る', () => {
    const pool = newPool();
    pool.hold('front', [FILE_A]);
    expect(pool.session(FILE_A)).toBeUndefined();
    const { made, factory } = recorder();
    pool.setFactory(factory);
    pool.hold('front', [FILE_A]);
    expect(made.map((s) => s.fileId)).toEqual([FILE_A]);
    pool.dispose();
  });
});
