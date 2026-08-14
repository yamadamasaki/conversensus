import { describe, expect, test } from 'bun:test';
import { isProcessAlive, watchParent } from './parentWatch';

/** 絶対に存在しない PID。PID は 32bit の範囲を超えないので割り当てられない */
const IMPOSSIBLE_PID = 2 ** 31;

describe('isProcessAlive', () => {
  test('自分自身は生きている', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  test('存在しない PID は生きていない', () => {
    expect(isProcessAlive(IMPOSSIBLE_PID)).toBe(false);
  });

  test('終了したプロセスは生きていない', () => {
    // **本物のプロセスで確かめる。** シグナル 0 の意味を取り違えていないことの確認で,
    // ここが逆だとデーモンは親の死を永遠に検知しない
    const child = Bun.spawnSync(['true']);

    expect(isProcessAlive(child.pid)).toBe(false);
  });
});

describe('watchParent', () => {
  test('親が居なくなったら知らせる', async () => {
    let gone = false;
    const stop = watchParent({
      pid: IMPOSSIBLE_PID,
      intervalMs: 1,
      isAlive: () => false,
      onGone: () => {
        gone = true;
      },
    });

    await Bun.sleep(20);

    expect(gone).toBe(true);
    stop();
  });

  test('親が生きている間は何もしない', async () => {
    let gone = false;
    const stop = watchParent({
      pid: process.pid,
      intervalMs: 1,
      isAlive: () => true,
      onGone: () => {
        gone = true;
      },
    });

    await Bun.sleep(20);

    expect(gone).toBe(false);
    stop();
  });

  test('一度知らせたら繰り返さない', async () => {
    // `onGone` は `process.exit` を呼ぶので, 二度呼ばれる形にしてはいけない
    let count = 0;
    const stop = watchParent({
      pid: IMPOSSIBLE_PID,
      intervalMs: 1,
      isAlive: () => false,
      onGone: () => {
        count += 1;
      },
    });

    await Bun.sleep(30);

    expect(count).toBe(1);
    stop();
  });

  test('止めたら知らせない', async () => {
    let gone = false;
    const stop = watchParent({
      pid: IMPOSSIBLE_PID,
      intervalMs: 5,
      isAlive: () => false,
      onGone: () => {
        gone = true;
      },
    });

    stop();
    await Bun.sleep(20);

    expect(gone).toBe(false);
  });
});
