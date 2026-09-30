import { describe, expect, it } from 'bun:test';
import { CausalClock } from './causalClock';
import { happenedBefore } from './causality';
import { LamportClock } from './unified';

const ME = 'did:plc:alice#dev';
const BOB = 'did:plc:bob#dev';

describe('CausalClock', () => {
  it('issue は clock を進め、seq を 1 から振り、deps に自分の項目を載せない', () => {
    const clock = new CausalClock(ME);
    expect(clock.issue()).toEqual({ clock: 1, seq: 1, deps: {} });
    expect(clock.issue()).toEqual({ clock: 2, seq: 2, deps: {} });
  });

  it('振った点は前に振った点の後になる (同じ actor の因果)', () => {
    const clock = new CausalClock(ME);
    const a = { actor: ME, ...clock.issue() };
    const b = { actor: ME, ...clock.issue() };
    expect(happenedBefore(a, b)).toBe(true);
  });

  it('observe した batch とその依存が、次の deps に入る。clock は受信分を追い越す', () => {
    const clock = new CausalClock(ME);
    clock.observe({ actor: BOB, seq: 3, deps: { carol: 2 }, clock: 10 });
    const stamp = clock.issue();
    expect(stamp.deps).toEqual({ [BOB]: 3, carol: 2 });
    expect(stamp.clock).toBe(12); // observe で max+1 = 11、issue で 12
  });

  it('restore は自分の最大 seq の続きから振り、ログの他人の点を知識に入れる', () => {
    const clock = new CausalClock(ME);
    clock.restore([
      { actor: ME, seq: 4, deps: {}, clock: 9 },
      { actor: BOB, seq: 7, deps: {}, clock: 8 },
    ]);
    expect(clock.issue()).toEqual({ clock: 10, seq: 5, deps: { [BOB]: 7 } });
  });

  it('restore は何度呼んでもよい (trunk と branch の tap がそれぞれのログから呼ぶ)', () => {
    const clock = new CausalClock(ME);
    const trunk = [{ actor: ME, seq: 2, deps: {}, clock: 2 }];
    const branch = [{ actor: ME, seq: 5, deps: {}, clock: 7 }];
    clock.restore(trunk);
    clock.restore(branch);
    clock.restore(trunk);
    expect(clock.issue().seq).toBe(6);
  });

  it('tickClock は clock だけを進め、点を振らない (merge の再スタンプ用)', () => {
    const clock = new CausalClock(ME);
    clock.tickClock();
    expect(clock.issue()).toEqual({ clock: 2, seq: 1, deps: {} });
  });

  it('渡した LamportClock を使う (既存の clock を共有する経路)', () => {
    const lamport = new LamportClock(20);
    const clock = new CausalClock(ME, lamport);
    clock.issue();
    expect(lamport.current()).toBe(21);
  });
});
