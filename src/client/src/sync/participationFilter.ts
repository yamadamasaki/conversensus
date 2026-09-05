/**
 * participationFilter: 参加期間の外の batch を、畳み込みに**入れる前に**落とす
 * (step2 Phase 2 S2)
 *
 * 設計: `deepse/plans/step2-phase2-sync.md` §3 /
 * スパイク: [u6-p2-report](../../../../deepse/spikes/u6-p2-report.md)
 *
 * U6-P2 の答えがこの形である — **判断の畳み込みの結果を述語にして、グラフの畳み込みに
 * 入れる前に落とす**。`projectFile` は何も知らない。依存は「判断 → グラフ」の一方向で、
 * 循環しない。
 *
 * ## 落とす位置は受信の前である
 *
 * ローカル正典に入れてから畳み込みで落とす形にはしない。仕様は「参加していた期間の
 * op-log **だけを同期する**」と定めているので、期間外の op が手元に残ること自体が反する。
 * 入れてしまうと、後で名簿が変わっても消す手立てが無い。
 *
 * ## 判定に使う DID は「batch の著者」である
 *
 * 「どの repo から読んだか」ではない。S0 の柵があれば両者は一致するが、**一致に
 * 依存しない** — 過去に複製されたレコードが PDS に残っていても、著者で判定すれば
 * 結論は変わらない。
 *
 * ## genesis は期間を持たない
 *
 * `GENESIS_ACTOR` は DID ではないので、どの参加期間にも入らない。しかし genesis は
 * **File の起源**であって誰かの判断ではなく、これを落とすと承認した側が起源を持たない
 * op-log を畳むことになる (シートが 1 枚も立ち上がらない)。**期間判定の対象外にする** —
 * S0 の送信側と同じ扱いである。
 *
 * ## ⚠️ 自分の repo には適用しない
 *
 * 呼び出し側の責務だが、ここに書いておく。自分のローカル正典は**権威**であって同期の
 * 対象ではない。かけると、`ensureOwnGenesis` が後から起点を置いた File で
 * **genesis より前に自分が書いた batch** が落ちる (起点の clock は最初の編集より後に
 * なりうる)。
 */

import type { Batch, Participation } from '@conversensus/shared';
import {
  didFromActor,
  GENESIS_ACTOR,
  wasParticipatingAt,
} from '@conversensus/shared';

/**
 * その batch を畳み込みに入れてよいか。
 *
 * 期間は閉じた始点・開いた終点 (`from <= clock < to`, `wasParticipatingAt`)。
 * 名簿にいない DID は「参加していない」に落ちるので、`didFromActor` が
 * `'local'` を返す (未ログインで書かれた) batch も自然に除かれる。
 */
export function isWithinParticipation(
  participation: Participation,
  batch: Batch,
): boolean {
  if (batch.actor === GENESIS_ACTOR) return true;
  return wasParticipatingAt(
    participation,
    didFromActor(batch.actor),
    batch.clock,
  );
}

/** `isWithinParticipation` を満たす batch だけを、入力順序を保って返す */
export function filterByParticipation(
  participation: Participation,
  batches: readonly Batch[],
): Batch[] {
  return batches.filter((batch) => isWithinParticipation(participation, batch));
}
