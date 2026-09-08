/**
 * 上書きの報告 (step2 Phase 3 T8)
 *
 * 設計: `deepse/plans/step2-phase3-conflict.md` §「T8: 上書きの報告」
 *
 * ## 何のためにあるか — 通知の向きの決着
 *
 * T5 の検出は `clock(自分) >= clock(新着)` のときだけ発火し、LWW も clock 順なので、
 * **検出する側 = LWW で勝つ側**になる (実 PDS で確認, 設計 §「通知は勝った方に出る」)。
 * つまり**自分の編集が残った人にだけ通知が出て、上書きされた人には何も出ない**。
 * 知らせるべき相手が逆である。
 *
 * ここはその**補集合**を拾う。同じ機構 (`mergeBranches`) に逆向きの clock フィルタを
 * かけるだけで、「相手が私の書いたものを別の値にした」が出る。
 *
 * ## これは「競合」ではない
 *
 * `clock(自分) < clock(新着)` は、相手が私の op を**見た上で**直した可能性を排除
 * できない (Lamport が言えるのは対偶の側だけである)。したがって「競合しました」とは
 * 言わない。**「あなたが書いた内容が、相手の編集で変わりました」という事実の報告**に
 * する。並行だったと主張しないので、偽陽性という概念がそもそも無い。
 *
 * ## T7 (fork の同期) を待たずに効く
 *
 * 設計上の補償は fork の同期だが、穴が 2 つある — fork の到着が通知の契機になって
 * いないことと、**layout は fork にならない**ことである。ここは受信の中で完結し、
 * **layout も含められる**。
 *
 * ## 境界は T5 と同じ `oldestIncoming` である
 *
 * 単位ごとに `clock(自分) < clock(相手の op)` で判定すると T5 と重なる区間ができ、
 * 同じ単位が「競合しました」と「上書きされました」の両方で出る。**T5 の
 * `ours = clock >= oldestIncoming` の正確な補集合**にすれば、差のある組は必ず
 * どちらか一方にだけ分類される。
 */

import {
  type Batch,
  type BatchId,
  type Did,
  didFromActor,
  type LayoutAspect,
  type MergeConflict,
  mergeBranches,
  type PropertyName,
  projectBatches,
} from '@conversensus/shared';
import { labelsOfConflicts } from './conflicts';

/**
 * 「あなたが書いたものが、相手の編集で別の値になった」1 件。
 *
 * **`MergeConflict` を使い回さない。**型が同じだと画面の側で混ざる — 競合と報告は
 * 言い方も扱いも別である、というのが T8 の決着そのものである。
 */
export type OverwriteReport = {
  /** 変わった対象の id (node / edge) */
  target: string;
  /** 仕様の 3 段のどれか。**layout も報告する** (fork にならないので他に伝える道が無い) */
  category: MergeConflict['category'];
  /** properties なら、どのプロパティが変わったか */
  propertyName?: PropertyName;
  /** layout なら、どの観点が変わったか */
  aspect?: LayoutAspect;
  /** 上書きした相手の DID。「誰の編集で変わったか」は報告の要点である */
  by: Did;
  /** 上書きされた自分の op が乗っていた batch */
  mine: BatchId;
  /** 上書きした相手の op が乗っていた batch */
  theirs: BatchId;
};

/** 検出した報告と、その対象を人が読める名前にするための対応表 */
export type DetectedOverwrites = {
  reports: OverwriteReport[];
  /** 対象 id → 分岐点での名前。引けなかった対象は入らない */
  labels: Map<string, string>;
};

export const NO_OVERWRITES: DetectedOverwrites = {
  reports: [],
  labels: new Map(),
};

/**
 * 報告の同一性。**単位は「対象 + 何について変わったか」**である (検出側の単位キーと同じ)。
 * 同じ対象に content と layout、あるいは position と size が並ぶので対象だけでは足りない。
 */
export function overwriteKeyOf(report: OverwriteReport): string {
  const about = report.aspect ?? report.propertyName ?? '';
  return `${report.category}:${report.target}:${about}`;
}

/**
 * 削除依存は報告しない。
 *
 * 「同じ単位が別の値になった」という報告の言い方に乗らないためである
 * (消された要素は「別の値」ではなく居なくなる)。**取り逃しではなく、意図した範囲外**
 * である — 削除の伝え方は tombstone (T2) と fork の同期 (T7) の側の問題で、
 * 報告の系列に混ぜると「変わりました」と「消えました」が同じ列に並ぶ。
 */
function isParallelChange(conflict: MergeConflict): boolean {
  return !(
    conflict.category === 'structure' && conflict.kind === 'removeDependency'
  );
}

function toReport(conflict: MergeConflict, by: Did): OverwriteReport {
  return {
    target: conflict.target,
    category: conflict.category,
    ...(conflict.propertyName !== undefined && {
      propertyName: conflict.propertyName,
    }),
    ...(conflict.category === 'layout' && { aspect: conflict.aspect }),
    by,
    mine: conflict.ours.batchId,
    theirs: conflict.theirs.batchId,
  };
}

/**
 * 新しく届いた分が、自分の書いたものを上書きしていないかを調べる。
 *
 * @param local    受信前に手元にあった batch (自分の編集も, 既に受け取った相手の分も)
 * @param incoming **新しく**届いた batch (`detectIncomingConflicts` と同じもの)
 * @param viewer   自分の DID。**「あなたが書いた」の判定は DID 単位である** —
 *   同じ人の別端末は別 actor だが、報告を読むのは端末ではなく人だからである
 */
export function detectOverwrites(
  local: readonly Batch[],
  incoming: readonly Batch[],
  viewer: Did,
): DetectedOverwrites {
  if (incoming.length === 0) return NO_OVERWRITES;

  // 分岐点は T5 と同じ「受信前の手元の状態」である
  const base = projectBatches([...local]);

  // **clock で絞らずに自分の op を全部渡す。**`mergeBranches` は単位ごとに
  // 「自分の最後の値」を引くので、ここで古い分だけを渡すと、既に T5 が競合として
  // 出した単位について**もっと古い私の値**が拾われ、同じ単位が二重に出る。
  // 絞るのは結果の側 (下の clock フィルタ) である
  const mine = local.filter((b) => didFromActor(b.actor) === viewer);
  const { conflicts } = mergeBranches(base, mine, [...incoming]);

  const oldestIncoming = incoming.reduce(
    (m, b) => Math.min(m, b.clock),
    Number.POSITIVE_INFINITY,
  );
  const clockOf = new Map(local.map((b) => [b.id, b.clock]));
  const incomingById = new Map(incoming.map((b) => [b.id, b]));

  // **単位ごとに 1 件に畳む。**`mergeBranches` は相手の op を 1 つずつ返すので、
  // 相手が同じところを 3 回直せば 3 件になる。報告として意味があるのは
  // 「最後にどうなったか」なので、単位ごとに最も新しい相手の op を採る
  const latest = new Map<string, OverwriteReport>();
  const clockOfTheirs = new Map<string, number>();
  for (const conflict of conflicts) {
    if (!isParallelChange(conflict)) continue;
    // T5 の補集合。**自分の最後の値が相手に見えていた側**だけを報告に回す
    const mineClock = clockOf.get(conflict.ours.batchId) ?? 0;
    if (mineClock >= oldestIncoming) continue;

    const theirs = incomingById.get(conflict.theirs.batchId);
    if (theirs === undefined) continue; // 相手側は必ず incoming 由来である
    const report = toReport(conflict, didFromActor(theirs.actor) as Did);
    const key = overwriteKeyOf(report);
    const prev = clockOfTheirs.get(key);
    if (prev === undefined || theirs.clock > prev) {
      latest.set(key, report);
      clockOfTheirs.set(key, theirs.clock);
    }
  }

  const reports = [...latest.values()];
  return { reports, labels: labelsOfConflicts(base, reports) };
}

/**
 * 画面が抱える報告の束。**受信サイクルをまたいで溜める。**
 *
 * 溜めるのは、この報告が**自動では出ない**からである (T8 の決着: 常設の印を置き、
 * 人が押したときだけ一覧を開く)。検出は競合と同じく 1 度きり — 次のサイクルでは
 * その batch は手元にあり `incoming` に入らない — なので、溜めないと
 * **人が見に行く前に消える**。
 */
export type OverwriteNoticeState = DetectedOverwrites;

export const NO_OVERWRITE_NOTICE: OverwriteNoticeState = NO_OVERWRITES;

/**
 * 新しく検出した報告を、溜めてある束へ足す。
 *
 * 同じ単位の報告は**後から来た方で置き換える** — 「いまどうなっているか」を見せたい
 * ので、古い上書きの記録を残しても読む人の役に立たない。
 */
export function accumulateOverwrites(
  prev: OverwriteNoticeState,
  next: DetectedOverwrites,
): OverwriteNoticeState {
  if (next.reports.length === 0) return prev;

  const byKey = new Map(prev.reports.map((r) => [overwriteKeyOf(r), r]));
  for (const report of next.reports) byKey.set(overwriteKeyOf(report), report);

  // 名前は先に引けた方を残す。分岐点は受信のたびに進むので、後の受信では既に
  // 消えていて引けないことがある
  const labels = new Map(next.labels);
  for (const [target, label] of prev.labels) {
    if (!labels.has(target)) labels.set(target, label);
  }
  return { reports: [...byKey.values()], labels };
}
