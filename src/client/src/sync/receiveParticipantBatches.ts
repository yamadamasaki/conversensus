/**
 * receiveParticipantBatches: 他 actor の repo からグラフの op-log を取り込む
 * (step2 Phase 2 S2)
 *
 * 設計: `deepse/plans/step2-phase2-sync.md` §2〜§3 /
 * アーキテクチャ: `deepse/architecture/step2.md` §2「読む順序は名簿 → グラフに固定される」
 *
 * `receiveRemoteBatches` (自分の repo = 別端末の分) と対になる、**他の参加者の repo**
 * スコープの受信。step1 の同期が自分の repo に閉じていたのに対し、ここが
 * 「書くのは自分の repo だけ、読むのは N 人の repo」の読み側そのものである。
 *
 * ## 名簿が先に無ければ呼べない
 *
 * 引数が `Participation` から始まるのは意味論的な順序である。**誰の repo を、いつから
 * いつまで読むか**は名簿しか答えられないので、名簿が確定する前にグラフを取りに行けない。
 * 型の形でその順序を強制している。
 *
 * ## 読む相手は「いま参加している actor」から自分を除いたもの
 *
 * - **自分を除く**のは `receiveRemoteBatches` が自分の repo を担うからである。二重に
 *   読んでも `appendReceivedBatches` のべき等性で無害だが、往復が倍になる
 * - **`invited` は読まない。**まだ参加していない actor は、参加期間が 1 つも開いて
 *   いないので、読んでも全部 `isWithinParticipation` で落ちる。名簿を広げるときに
 *   `invited` の repo を読む (`readRoster`) のとは目的が違う
 * - **離脱した actor も読まない。**過去の参加期間の op は既に取り込み済である
 *   (取り込めていなければ、離脱した相手の repo をいつまで読み続けるかという別の
 *   問題になる。§6「再参加時の同期義務」に繋がる論点で、ここでは開かない)
 *
 * ## 既読位置 (cursor) は持たない
 *
 * 参加者ごとにそのファイルの範囲を毎回頭から読む。step1 が既読位置を捨てた理由
 * (clock は端末をまたぐと単調でないので rkey 順に seek すると取りこぼす) は、DID ごとに
 * 分けても消えない — 1 DID が複数端末を持つからである (設計 事実 C)。
 * 取りこぼしゼロを構造で保証し、二重取り込みは受信側のべき等性が無害化する。
 *
 * ## 1 人の失敗で全体を止めない
 *
 * 相手の PDS が一時的に応答しないことは正常に起こる。**読めた分は取り込み、読めなかった
 * 相手は理由とともに返す** (`unreadable`)。名簿の読み出し (`readRoster`) が同じ判断を
 * しているのと揃えている。
 */

import type {
  Batch,
  Did,
  FileId,
  Lamport,
  Participation,
} from '@conversensus/shared';
import type { RemoteBatch } from '../atproto/types';
import { filterByParticipation } from './participationFilter';

export type ReceiveParticipantDeps = {
  /** その actor の repo から、このファイル分の batch を取得する (範囲取得) */
  pullRemoteForFile: (fileId: FileId, repo: Did) => Promise<RemoteBatch[]>;
  /** ローカル正典へ受信追記する (marker を立てる経路であること) */
  appendReceived: (fileId: FileId, batches: Batch[]) => Promise<number>;
  /** 自端末 clock を Lamport 受信規則で前進させる */
  observeRemote: (remoteClock: Lamport) => void;
};

export type ReceiveParticipantResult = {
  /** 実際に読んだ repo (自分は含まない) */
  readRepos: Did[];
  /** 参加期間の中にあるとして取り込みの対象にした batch 数 */
  received: number;
  /** ローカル正典に**新規に**追記された batch 数 */
  appended: number;
  /**
   * 参加期間の外だったため落とした batch 数。
   *
   * **0 でないことは異常ではない。**取り消された actor の repo には、取り消し後の op が
   * そのまま残る (相手はそれを消さない)。この数はその op が手元に入っていないことの証拠で
   * あり、完了基準 3「参加を取りやめた後、その操作が相手に反映されなくなる」の観測点である。
   */
  outsidePeriod: number;
  /** 他ファイル宛だったため落とした batch 数 (rkey とボディの食い違いの検知器) */
  skippedOtherFile: number;
  /** 読めなかった repo と理由。**失敗で全体を落とさない** */
  unreadable: { did: Did; error: unknown }[];
};

/**
 * 名簿の参加者 (自分を除く) の repo を読み、参加期間の中の batch をローカル正典へ取り込む。
 *
 * べき等: 同じ状態で 2 回呼んでも `appended` が 0 になるだけである。
 */
export async function receiveParticipantBatches(
  fileId: FileId,
  participation: Participation,
  viewer: Did,
  deps: ReceiveParticipantDeps,
): Promise<ReceiveParticipantResult> {
  // **読む順序を名簿の反復順に依存させない。**誰の手元でも同じ結果になるべきで、
  // Set の反復順に結論が左右される形にしない (`readRoster` と同じ判断)
  const repos = [...participation.participating]
    .filter((did) => did !== viewer)
    .sort((a, b) => a.localeCompare(b));

  const result: ReceiveParticipantResult = {
    readRepos: [],
    received: 0,
    appended: 0,
    outsidePeriod: 0,
    skippedOtherFile: 0,
    unreadable: [],
  };

  for (const did of repos) {
    let entries: RemoteBatch[];
    try {
      entries = await deps.pullRemoteForFile(fileId, did);
    } catch (error) {
      result.unreadable.push({ did, error });
      continue;
    }
    result.readRepos.push(did);

    // 適用先の権威はボディの fileId (rkey は取得経路の索引にすぎない)。孤児 batch を
    // 作らない不変条件を rkey 形式の正しさに依存させないための防御 (4d 設計 §1.11 D-4)
    const addressed = entries.filter((e) => e.fileId === fileId);
    result.skippedOtherFile += entries.length - addressed.length;

    const all = addressed.map((e) => e.batch);
    const within = filterByParticipation(participation, all);
    result.outsidePeriod += all.length - within.length;
    if (within.length === 0) continue;

    result.received += within.length;
    result.appended += await deps.appendReceived(fileId, within);

    // 受信規則。**書き込みが成功してから前進させる** — 失敗して取り込めていないのに
    // clock だけ進むと、次に発番する batch が「取り込めなかった編集より後」を騙る
    deps.observeRemote(within.reduce((m, b) => Math.max(m, b.clock), 0));
  }

  if (result.skippedOtherFile > 0) {
    console.warn(
      `[sync] receive: dropped ${result.skippedOtherFile} batch(es) addressed to ` +
        `another file while fetching ${fileId} — rkey and record fileId disagree`,
    );
  }
  for (const { did, error } of result.unreadable) {
    console.warn(`[sync] receive: could not read ${did}'s repo:`, error);
  }

  return result;
}
