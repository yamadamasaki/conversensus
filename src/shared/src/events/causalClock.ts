/**
 * 因果の発番器 (step3 Phase 1 S1-3 / 設計 D1)。
 *
 * 1 つの actor が 1 つの trunk File について持つ。**trunk・その branch・判断ログで共有する**
 * — 3 つとも同じ因果の範囲にあり (branch の base は trunk の到達点で、判断ログは trunk の
 * op と比べられる)、別々に振ると同じ点 `(actor, seq)` を 2 回使ってしまう。
 *
 * 持つものは 3 つ:
 * - **Lamport clock**: 畳み込みの全順序に使う (今までどおり)
 * - **seq**: 自分の点の連番
 * - **因果の知識**: 自分が書いたものと受け取ったもの (とそれらの `deps`) の vector。
 *   次に書く batch の `deps` になる
 */

import {
  type CausalPoint,
  depsFor,
  EMPTY_VECTOR,
  joinVectors,
  knowledgeOf,
  observe,
  type Seq,
  type VersionVector,
} from './causality';
import { type Actor, type Lamport, LamportClock } from './unified';

/** batch に押す印 */
export type CausalStamp = { clock: Lamport; seq: Seq; deps: VersionVector };

/** 受け取った batch のうち、発番器が見るもの */
export type ObservedPoint = CausalPoint & { clock: Lamport };

export class CausalClock {
  private readonly self: Actor;
  private readonly lamport: LamportClock;
  private seq: Seq = 0;
  private knowledge: VersionVector = EMPTY_VECTOR;

  constructor(self: Actor, lamport: LamportClock = new LamportClock()) {
    this.self = self;
    this.lamport = lamport;
  }

  get actor(): Actor {
    return this.self;
  }

  /**
   * 永続ログから復元する。**何度呼んでもよい** (各値の最大を取るだけ) —
   * trunk の tap と branch の tap がそれぞれのログから呼ぶ。
   *
   * clock は `seed` (+1 しない) で、次の発番が最大値の次になる。seq は自分の点の最大。
   */
  restore(points: Iterable<ObservedPoint>): void {
    const list = [...points];
    this.lamport.seed(list.reduce((m, p) => Math.max(m, p.clock), 0));
    for (const p of list) {
      if (p.actor === this.self && p.seq > this.seq) this.seq = p.seq;
    }
    this.knowledge = joinVectors(this.knowledge, knowledgeOf(list));
  }

  /** 次の点を振る。振った点は自分の知識に入る */
  issue(): CausalStamp {
    const clock = this.lamport.tick();
    this.seq += 1;
    const deps = depsFor(this.knowledge, this.self);
    this.knowledge = observe(this.knowledge, {
      actor: this.self,
      seq: this.seq,
      deps,
    });
    return { clock, seq: this.seq, deps };
  }

  /** 受け取った batch を観測する (Lamport の受信規則 + 因果の知識への取り込み) */
  observe(point: ObservedPoint): void {
    this.lamport.observe(point.clock);
    this.knowledge = observe(this.knowledge, point);
  }

  /**
   * clock の下限を引き上げる (+1 しない)。branch の op-log が分岐点の続きから発番するため
   * (`clockFloor`) に使う
   */
  seedClock(floor: Lamport): void {
    this.lamport.seed(floor);
  }

  /** いまの因果の知識 (分岐点の vector などに使う) */
  currentKnowledge(): VersionVector {
    return this.knowledge;
  }
}
