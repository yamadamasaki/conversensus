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
 *
 * ## 歯抜けの先に届いた batch (D2 の決定, 2026-10-13)
 *
 * **歯抜けの先の batch も「知っている」に数える。**actor X の k 番目を持っていれば、その手前の j を
 * まだ持っていなくても、知識は X:k になる。当初の設計 (Phase 1 U3) は「判断では歯抜けの先を見ていない
 * 側に数える」としていたが、歯抜けは**恒久的に生じる** — 参加期間のフィルタは離脱中の batch を取り込まず、
 * 1 人の seq は trunk・branch・判断ログで 1 系列なので手元に無い branch の分が歯抜けに見える。歯抜けで
 * 止めると、その人の以後の編集が並行に見え続け、競合が出続ける。
 *
 * 受け入れた穴: X の j が届く前に k が届き、その間に自分が j と同じ要素を編集すると、自分の deps は
 * 「j を見た」と言う。後から j が届いても並行と判定されず、競合として知らされずに自分の編集が勝つ。
 * 起きるのは「X の送信が一部だけ遅れている」と「遅れた編集と同じ要素をその間に触る」が重なるときだけで、
 * 受信は毎回 File の先頭から読み、送れなかった batch は送り手が送り直すので、歯抜けは普通すぐ埋まる
 * (`deepse/plans/step3-phase1-oplog-v2.md` の U3 の決着)
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
 * actor ごとに**持っている最大の seq** (歯抜けを気にしない)。分岐点の vector に使う
 * (`makeBaseCommit`)。
 *
 * 歯抜けで止まらない。歯抜けは転送中にだけ生じるとは限らず、
 * **参加期間のフィルタが離脱中の batch を取り込まない**ので恒久的にも生じる。歯抜けで止まると、
 * いったん離脱して戻った人のその後の編集が、どの分岐点にも入らなくなる
 */
export function heldMaxima(
  points: Iterable<Pick<CausalPoint, 'actor' | 'seq'>>,
): VersionVector {
  const out: Record<Actor, Seq> = {};
  for (const { actor, seq } of points) {
    if (seq > (out[actor] ?? 0)) out[actor] = seq;
  }
  return out;
}
