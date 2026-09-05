/**
 * 再参加した actor の同期義務 (step2 Phase 2 S6)
 *
 * 設計: `deepse/plans/step2-phase2-sync.md` §6
 * 仕様: `deepse/requirements/spec/participation.md` ワークフロー 6-3
 *
 * **離脱中は受け取っていない。**期間フィルタは著者の期間で落とすので、離脱していた
 * 間の他の参加者の編集は手元に入っていない。その状態で編集すると、**手元にしか無い
 * ものに依存した op** が生まれ、受け取った側でエラーになる。
 *
 * だから仕様は「**再度参加する前に標準 projection へ同期しなければならない**」と定める。
 *
 * ## 頼まない
 *
 * ダイアログで「同期してください」と頼む形にはしない。**頼んで守られなかった場合に
 * 壊れるのは相手**なので、守らせる側に置けない義務は義務ではない。同期が済むまで
 * その File を読み取り専用にする。
 *
 * ## ⚠️ これは「取りこぼした op を後から入れる」ではない
 *
 * 再参加した actor は、非参加期間の**他人の** op を期間フィルタで落とさない
 * (フィルタは**著者**の期間であって読み手の期間ではない)。落ちるのは自分が非参加
 * だった期間に**自分が**書いた op である。つまり同期すれば手元は追いつく。
 * 義務があるのは「追いつく前に書かない」ことだけである。
 */

import type { Did, Lamport, Participation } from '@conversensus/shared';
import { periodsOf } from '@conversensus/shared';

/**
 * その actor が果たすべき同期義務。**最後に開いた参加期間の始点**を返す。
 * 義務が無ければ `null`。
 *
 * **期間が 2 つ以上あることが「再参加した」の定義である。**1 つ目は初参加
 * (作成 or 最初の承認) で、そのとき手元に取りこぼしは無い。
 *
 * **期間の始点を返すのは、義務を果たしたかどうかを覚えるための鍵**である。
 * 真偽値だと「一度同期した」を覚えた後にもう一度離脱・再参加しても義務が生まれない。
 * 始点は再参加のたびに変わるので、鍵として使える。
 *
 * 引き取り (`participation.reopen`) も期間を開くので、同じ扱いになる —
 * 誰もいなくなった File を引き取った人も、離脱中の他人の編集を取りこぼしている。
 */
export function rejoinObligation(
  participation: Participation,
  viewer: Did,
): Lamport | null {
  const periods = periodsOf(participation, viewer);
  if (periods.length <= 1) return null;
  return periods[periods.length - 1]?.from ?? null;
}
