/**
 * 競合の検出まわりで、explicit merge と implicit merge が分け合うもの
 * (step2 Phase 3 T4 / T5)
 */

import type {
  Batch,
  EdgeId,
  MergeConflict,
  NodeId,
  ProjectedGraph,
} from '@conversensus/shared';
import { mergeBranches, projectBatches } from '@conversensus/shared';

/**
 * 競合の対象の**分岐点での名前** (node の content / edge の label)。
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
  conflicts: readonly MergeConflict[],
): Map<string, string> {
  const labels = new Map<string, string>();
  for (const { target } of conflicts) {
    if (labels.has(target)) continue;
    const node = base.nodes.get(target as NodeId);
    if (node) {
      labels.set(target, node.content);
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
 * implicit merge の競合検出 (step2 Phase 3 T5)
 *
 * ## 分岐点は「受信前の手元の状態」である
 *
 * explicit merge の `meta.base.at` に相当するものが implicit merge には無い。
 * 設計は「受信した batch の最小 clock の直前」を素直な案としていたが、**実装と
 * 噛み合わなかった** — 受信は既読位置を持たず毎回頭から全件読むので、最小 clock は
 * 毎回ログの先頭になる。新規分に限っても、clock は端末をまたぐと単調でないので
 * 「その時点の状態」が曖昧である (既読位置を捨てた理由そのもの)。
 *
 * そこで**分岐点を受信側の状態として定義する**。「私が見ていたグラフ」が基準で、
 * 知りたいのはまさに「届いた削除が、私のいまのグラフで何を消すか」である。
 *
 * **相手が何人いても分岐点は 1 つになる。**設計が心配していた「受信は複数の actor から
 * 同時に来るので 1 つの分岐点に畳めるとは限らない」は、この定義では構造的に消える。
 *
 * ## ⚠️ ours は「手元の全部」ではない — Lamport の対偶で絞る
 *
 * 手元の op を全部 ours にすると、**順次編集がすべて競合になる**。「私が書いた文章を、
 * 相手がそれを読んで直した」は競合ではないのに、`lastByKey` は「私の最後の値」と
 * 「相手の新しい値」を比べて違いを見つけてしまう。実測で確かめた。
 *
 * 絞る根拠は Lamport の保証の対偶である。`a → b` (因果) ならば
 * `clock(a) < clock(b)` なので、**`clock(m) >= clock(t)` なら `m → t` ではない** —
 * 相手はその op を見ずに `t` を出した。したがって
 *
 * > **ours = 手元の op のうち、新着の clock 以上のもの**
 *
 * とすれば「相手が既に見ていた私の編集」は落ちる。**偽陽性が構造的に出ない。**
 *
 * ## 片側で取り逃しても、相手側が捕まえる
 *
 * clock が小さい側は自分の op を ours に入れられないので検出しない。**それでよい** —
 * そのとき相手の clock は大きいので、**相手の手元では検出される**。fork は競合そのものから
 * 同一性が導かれるので、相手の書いた fork が同期されて私にも届く。「相手同士の競合は
 * 見ない」と同じ論法である。clock が同値なら両方が検出し、fork は畳まれる。
 *
 * ## ours / theirs の意味
 *
 * `MergeConflict` の ours / theirs は explicit merge では trunk / branch だが、
 * ここでは**手元 / 新着**である。
 *
 * ## 相手同士の競合は見ない
 *
 * Bob と Carol が互いに競合しても、私の手元では両方が新着なので 2 側構造では出ない。
 * **それでよい** — Bob と Carol はそれぞれの手元で互いを受信して検出し、fork は競合
 * そのものから同一性が導かれるので、彼らの書いた fork が同期されて私にも届く。
 * 総当たりにすると検出が参加者数の 2 乗になり、同じ fork を全員が書くことになる。
 *
 * ## 同じ競合は 1 度しか検出されない
 *
 * 対象は**新しく届いた batch だけ**である。次のサイクルではその batch は手元にあり
 * `incoming` に入らないので、同じ競合が毎サイクル通知されることはない。既読位置を
 * 持たない設計が、ここでは畳み込みとして効いている。
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

  // 相手が見ていなかったと**言い切れる**私の op だけを ours にする (上の対偶)。
  // 境界は新着の最小 clock — 新着が複数あるとき、より新しい相手の op から見れば
  // 見えていた可能性のある私の op も混じるが、**取り逃すよりは出す**方に倒す
  const oldestIncoming = incoming.reduce(
    (m, b) => Math.min(m, b.clock),
    Number.POSITIVE_INFINITY,
  );
  const ours = local.filter((b) => b.clock >= oldestIncoming);

  const { conflicts } = mergeBranches(base, ours, [...incoming]);
  return { conflicts, labels: labelsOfConflicts(base, conflicts) };
}
