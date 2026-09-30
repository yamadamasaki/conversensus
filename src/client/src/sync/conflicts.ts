/**
 * 競合の検出まわりで、explicit merge と implicit merge が分け合うもの
 * (step2 Phase 3 T4 / T5)
 */

import type {
  Batch,
  BatchId,
  EdgeId,
  MergeConflict,
  NodeId,
  ProjectedGraph,
} from '@conversensus/shared';
import {
  concurrent,
  happenedBefore,
  mergeBranches,
  projectBatches,
} from '@conversensus/shared';

/** 名前に載せる本文の長さ。通知の 1 行に収まり、かつ区別がつく程度 */
const CONTENT_HEAD_LENGTH = 20;

/** 本文の先頭だけを取る。切ったことが分かるように `…` を付ける */
function headOf(content: string): string {
  const head = content.slice(0, CONTENT_HEAD_LENGTH);
  return head.length < content.length ? `${head}…` : head;
}

/**
 * 競合の対象の**分岐点での名前**。
 *
 * node は **「ラベル + 本文の先頭」** (`反論: 気温の記録は…`)、edge は label である
 * (Phase 5 P7)。**ラベルだけでは足りない** — ラベルはクラス名の位置づけなので
 * 「反論」は一つのグラフに複数ある。Phase 5 が通知にもたらすのは**絞り込みであって
 * 特定ではない** (通知から実物のノードを指すのは step3)。本文だけの現状より狭まる、
 * というのが効きの正確な大きさである。
 *
 * **ここで template を引かない。**node が `label` を**値として持っている**ので
 * (設計 D3 の「label も併せて持つ」)、op-log を読むだけの側が template を要らない。
 * これがその判断の主な受益者である。
 *
 * **適用後の projection からは引けない。**削除依存の対象はまさに消された要素なので、
 * 適用後のグラフには居ない。分岐点には必ず在る — 相手がそれを前提にした op を出せた
 * 時点で在ったからである。
 *
 * 空文字はそのまま返す。「名前が無い」と「引けなかった」は別の話なので、言い換えるか
 * どうかは見せる側が決める。
 */
export function labelsOfConflicts(
  base: ProjectedGraph,
  /**
   * 名前を引きたい対象。**`MergeConflict` に限らない** — 上書きの報告 (T8) も
   * 同じ「分岐点での名前」を要るので、`target` だけを要求する形にしてある
   */
  conflicts: readonly { target: string }[],
): Map<string, string> {
  const labels = new Map<string, string>();
  for (const { target } of conflicts) {
    if (labels.has(target)) continue;
    const node = base.nodes.get(target as NodeId);
    if (node) {
      const head = headOf(node.content);
      // ラベルが無ければ本文だけ。**空のラベルで `: ` が浮くのを避ける**
      labels.set(target, node.label ? `${node.label}: ${head}` : head);
      continue;
    }
    const edge = base.edges.get(target as EdgeId);
    if (edge) labels.set(target, edge.label ?? '');
  }
  return labels;
}

/** 検出した競合と、その対象を人が読める名前にするための対応表 */
export type DetectedConflicts = {
  conflicts: MergeConflict[];
  /** 対象 id → 分岐点での名前。引けなかった対象は入らない */
  labels: Map<string, string>;
};

/**
 * 対立した組 (ours = 手元の batch, theirs = 新着の batch) の因果の関係 (step3 Phase 1 D4)。
 *
 * - `concurrent`: 互いに相手を見ずに書いた — **競合** (T5)
 * - `seen`: 相手が私の側を見た上で書いた — **上書きの報告** (T8)
 * - `other`: 新着の方が前 (因果の知識では知っていたが、batch は遅れて届いた)。
 *   手元が新着を見た上で書いているので、競合でも上書きでもない
 *
 * **3 つは排他かつ網羅である。**step2 は境界を「新着の最小 clock」という scalar 1 つで
 * 引いていたので、純粋な並行が clock の大小で「競合」と「変わりました」に振り分けられ、
 * 同じ組が端末によって別の側に出た (step3-entry §2.1)。並行は対称なので、
 * **どちらの手元でも同じ組が同じ側に振られる。**
 */
export type PairRelation = 'concurrent' | 'seen' | 'other';

/** batch id から組の関係を引く。組の両側は必ず手元と新着に居る */
export function relationOfPair(
  conflict: Pick<MergeConflict, 'ours' | 'theirs'>,
  batchOf: ReadonlyMap<BatchId, Batch>,
): PairRelation {
  const ours = batchOf.get(conflict.ours.batchId);
  const theirs = batchOf.get(conflict.theirs.batchId);
  if (ours === undefined || theirs === undefined) return 'other';
  if (concurrent(ours, theirs)) return 'concurrent';
  return happenedBefore(ours, theirs) ? 'seen' : 'other';
}

/** 手元と新着を 1 つの引き表にする */
export function batchIndex(
  local: readonly Batch[],
  incoming: readonly Batch[],
): Map<BatchId, Batch> {
  return new Map([...local, ...incoming].map((b) => [b.id, b]));
}

/**
 * implicit merge の競合検出 (step2 Phase 3 T5 / step3 Phase 1 D4)
 *
 * ## 分岐点は「受信前の手元の状態」である
 *
 * explicit merge の `meta.base` に相当するものが implicit merge には無い。そこで
 * **分岐点を受信側の状態として定義する**。「私が見ていたグラフ」が基準で、
 * 知りたいのはまさに「届いた削除が、私のいまのグラフで何を消すか」である。
 * **相手が何人いても分岐点は 1 つになる。**
 *
 * ## 競合は「並行な組」だけ
 *
 * 手元の op を全部 ours にして `mergeBranches` を当て、出てきた組のうち**並行なもの**だけを
 * 残す (`relationOfPair`)。手元の op を全部渡すだけだと順次編集 (「私が書いた文章を、相手が
 * 読んで直した」) がすべて競合になる — `lastByKey` は「私の最後の値」と「相手の新しい値」の
 * 違いを見つけてしまう。それを落とすのが因果の判定である。
 *
 * step2 は vector を持たなかったので、Lamport の対偶 (`clock(m) >= clock(t)` なら
 * `m → t` ではない) で ours を絞っていた。これは片側でしか言えないので、**clock の小さい側は
 * 並行でも検出できなかった**。いまは並行が対称に判定できるので、**両方の手元で検出する**。
 * fork は競合そのものから同一性が導かれるので、両方が書いても畳まれる。
 *
 * ## ours / theirs の意味
 *
 * `MergeConflict` の ours / theirs は explicit merge では trunk / branch だが、
 * ここでは**手元 / 新着**である。
 *
 * ## 第三者の検出は、届き方で決まる
 *
 * ours は手元の全部なので、Carol は「前に受け取った Alice の編集」と「いま届いた Bob の編集」の
 * 対立も検出する。両方が同じ受信で新着になれば 2 側構造では出ない。どちらでもよい —
 * fork は競合そのものから同一性が導かれるので、誰が書いても畳まれ、検出しなかった人には
 * fork の到着 (T7-5) が伝える。
 *
 * ## 同じ競合は 1 度しか検出されない
 *
 * 対象は**新しく届いた batch だけ**である。次のサイクルではその batch は手元にあり
 * `incoming` に入らないので、同じ競合が毎サイクル通知されることはない。
 *
 * @param local    受信前に手元にあった batch (自分の編集も, 既に受け取った相手の分も)
 * @param incoming **新しく**届いた batch。既知のものを混ぜてはならない —
 *   同じ batch が両側に居ると、自分自身との衝突を検出しうる
 */
export function detectIncomingConflicts(
  local: readonly Batch[],
  incoming: readonly Batch[],
): DetectedConflicts {
  if (incoming.length === 0) return { conflicts: [], labels: new Map() };

  // **分岐点は手元の現在の状態である** — 知りたいのは「届いた削除が、私のいまのグラフで
  // 何を消すか」なので、カスケードを当てる先は現在の状態でなければならない
  const base = projectBatches([...local]);

  const batchOf = batchIndex(local, incoming);
  const conflicts = mergeBranches(
    base,
    [...local],
    [...incoming],
  ).conflicts.filter((c) => relationOfPair(c, batchOf) === 'concurrent');
  return { conflicts, labels: labelsOfConflicts(base, conflicts) };
}
