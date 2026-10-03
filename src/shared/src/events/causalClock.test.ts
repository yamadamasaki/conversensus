import { describe, expect, it } from 'bun:test';
import fc from 'fast-check';
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

  it('渡した LamportClock を使う (既存の clock を共有する経路)', () => {
    const lamport = new LamportClock(20);
    const clock = new CausalClock(ME, lamport);
    clock.issue();
    expect(lamport.current()).toBe(21);
  });
});

describe('CausalClock: 同じ actor の発番器が 2 つあるとき', () => {
  /**
   * 判断ログの使い捨ての発番器 (other) と、グラフの tap の発番器 (mine)。どちらも振る前に相手が
   * 振った点を観測する (受信・復元で互いのログを読む)
   */
  const arbTurn = fc.record({
    who: fc.constantFrom('mine', 'other'),
    count: fc.integer({ min: 1, max: 3 }),
  });

  it('∀ 振る順. 相手の点を観測してから振るなら、同じ (actor, seq) は 2 度振られない', () => {
    fc.assert(
      fc.property(fc.array(arbTurn, { maxLength: 8 }), (turns) => {
        const clocks = {
          mine: new CausalClock(ME),
          other: new CausalClock(ME),
        };
        const issued: {
          who: string;
          actor: string;
          seq: number;
          clock: number;
          deps: Record<string, number>;
        }[] = [];
        for (const { who, count } of turns) {
          const clock = clocks[who as 'mine' | 'other'];
          for (const p of issued.filter((p) => p.who !== who)) clock.observe(p);
          for (let i = 0; i < count; i++) {
            issued.push({ who, actor: ME, ...clock.issue() });
          }
        }
        const seqs = issued.map((p) => p.seq);
        expect(new Set(seqs).size).toBe(seqs.length);
      }),
    );
  });

  it('使い捨ての発番器が振った判断 (seq 1) を観測した後の編集は seq 2 になる (S5-3 で発覚した例)', () => {
    const judgment = new CausalClock(ME).issue();
    const tap = new CausalClock(ME);
    tap.observe({ actor: ME, ...judgment });
    expect(tap.issue().seq).toBe(2);
  });
});
