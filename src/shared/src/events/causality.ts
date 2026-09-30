/**
 * 因果の文脈 (step3 Phase 1 S1-2 / 設計 `deepse/plans/step3-phase1-oplog-v2.md` D1)。
 *
 * batch は**点** `(actor, seq)` と、書いた時点で知っていた因果の過去 `deps` を持つ。
 * ここはその判定を集めた純粋関数である。
 *
 * **畳み込みの順序はここで決めない。**順序は今までどおり `compareByClockActorId`
 * (Lamport → actor → id) の全順序で、SEC の土台はそちらにある。vector が答えるのは
 * 「2 つの操作は並行か」だけで、競合・上書きの報告・参加期間・分岐点の判断に使う。
 *
 * ## 2 つの vector を区別する
 *
 * - **因果の知識** (`knowledgeOf` / `observe`): 受け取った batch の `deps` も取り込んだ
 *   vector。**batch の `deps` はこちらである。**持っていない batch も、受け取った batch が
 *   依存していれば「知っている」に入る。こうしないと推移律が崩れる — B が A を見て書いた
 *   batch を C が受け取って書いたとき、C が A の batch を持っていなくても、A は C より前である
 * - **手元の到達点** (`contiguousFrontier`): actor ごとに**歯抜けなく持っている**最大の seq。
 *   「私は何を判断できるか」を問うときに使う (設計 U3)
 */

import type { Actor } from './unified';

/** actor ごとの連番。1 から始まり、その actor の batch ごとに 1 つずつ増える */
export type Seq = number;

/** actor ごとの seq。項目が無い actor は 0 (= 1 つも知らない) と読む */
export type VersionVector = Readonly<Record<Actor, Seq>>;

/** 因果の判定に要る batch の部分 */
export type CausalPoint = {
  actor: Actor;
  seq: Seq;
  /** 書いた時点の因果の知識。**自分の項目は載せない** (seq - 1 と決まっている) */
  deps: VersionVector;
};

export const EMPTY_VECTOR: VersionVector = Object.freeze({});

/** vector の項目を読む。無い actor は 0 */
export function seqIn(vector: VersionVector, actor: Actor): Seq {
  return vector[actor] ?? 0;
}

/** 点 `(actor, seq)` が vector に覆われるか (= その点を因果の過去に含むか) */
export function covers(vector: VersionVector, actor: Actor, seq: Seq): boolean {
  return seqIn(vector, actor) >= seq;
}

/**
 * a は b より前か (a → b)。
 *
 * 同じ actor なら seq の大小、違う actor なら b が a を因果の過去に含むか。
 * **定数時間**で答えられるのは、`deps` が推移的に閉じている (受け取った batch の `deps` も
 * 取り込んでいる) からである (冒頭の注)。
 */
export function happenedBefore(a: CausalPoint, b: CausalPoint): boolean {
  if (a.actor === b.actor) return a.seq < b.seq;
  return covers(b.deps, a.actor, a.seq);
}

/** a と b は並行か (どちらも他方の前でなく、同じ点でもない) */
export function concurrent(a: CausalPoint, b: CausalPoint): boolean {
  if (a.actor === b.actor && a.seq === b.seq) return false;
  return !happenedBefore(a, b) && !happenedBefore(b, a);
}

/** 2 つの vector の各項目の最大 */
export function joinVectors(a: VersionVector, b: VersionVector): VersionVector {
  const out: Record<Actor, Seq> = { ...a };
  for (const [actor, seq] of Object.entries(b)) {
    if (seq > (out[actor] ?? 0)) out[actor] = seq;
  }
  return out;
}

/** batch を受け取ったあとの因果の知識。その batch の点と、それが依存していたもの */
export function observe(
  knowledge: VersionVector,
  point: CausalPoint,
): VersionVector {
  return joinVectors(joinVectors(knowledge, point.deps), {
    [point.actor]: point.seq,
  });
}

/** batch の集まりが含意する因果の知識 */
export function knowledgeOf(points: Iterable<CausalPoint>): VersionVector {
  let knowledge = EMPTY_VECTOR;
  for (const point of points) knowledge = observe(knowledge, point);
  return knowledge;
}

/**
 * 自分が次に書く batch の `deps`。因果の知識から自分の項目を除いたもの
 * (自分の分は seq - 1 と決まっているので載せない)
 */
export function depsFor(knowledge: VersionVector, self: Actor): VersionVector {
  const { [self]: _own, ...others } = knowledge;
  return others;
}

/**
 * 手元の到達点。actor ごとに、1 から**歯抜けなく**持っている最大の seq。
 *
 * 歯抜けの先の batch は持っていても数えない — その間の batch を見ていない以上、
 * 「その actor の k 番目までを見た」とは言えない。
 */
export function contiguousFrontier(
  points: Iterable<Pick<CausalPoint, 'actor' | 'seq'>>,
): VersionVector {
  const seqsByActor = new Map<Actor, Set<Seq>>();
  for (const { actor, seq } of points) {
    let seqs = seqsByActor.get(actor);
    if (!seqs) {
      seqs = new Set();
      seqsByActor.set(actor, seqs);
    }
    seqs.add(seq);
  }
  const frontier: Record<Actor, Seq> = {};
  for (const [actor, seqs] of seqsByActor) {
    let k = 0;
    while (seqs.has(k + 1)) k += 1;
    if (k > 0) frontier[actor] = k;
  }
  return frontier;
}
