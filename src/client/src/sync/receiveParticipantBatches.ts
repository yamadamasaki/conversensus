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
  ForkMeta,
  Lamport,
  Participation,
} from '@conversensus/shared';
import type { RemoteBatch } from '../atproto/types';
import { type DetectedConflicts, detectIncomingConflicts } from './conflicts';
import { filterByParticipation } from './participationFilter';
import { type ForkWriterDeps, writeForksForConflicts } from './writeForks';

export type CollectParticipantDeps = {
  /** その actor の repo から、このファイル分の batch を取得する (範囲取得) */
  pullRemoteForFile: (fileId: FileId, repo: Did) => Promise<RemoteBatch[]>;
};

export type ReceiveParticipantDeps = CollectParticipantDeps & {
  /**
   * 受信**前**のローカル正典を読む (step2 Phase 3 T5)。
   *
   * 2 つに要る — **どの batch が新しいか**の判定と、**分岐点のグラフ**である。
   * どちらも「受信前の手元」を指すので、追記より先に読まなければならない。
   */
  fetchLocal: (fileId: FileId) => Promise<Batch[]>;
  /** ローカル正典へ受信追記する (marker を立てる経路であること) */
  appendReceived: (fileId: FileId, batches: Batch[]) => Promise<number>;
  /** 自端末 clock を Lamport 受信規則で前進させる */
  observeRemote: (remoteClock: Lamport) => void;
} & ForkWriterDeps;

export type CollectParticipantResult = {
  /** 取り込んでよい batch (参加期間の中・このファイル宛)。読んだ repo の順 */
  batches: Batch[];
  /** 実際に読んだ repo (自分は含まない) */
  readRepos: Did[];
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

export type ReceiveParticipantResult = CollectParticipantResult & {
  /** 参加期間の中にあるとして取り込みの対象にした batch 数 (= `batches.length`) */
  received: number;
  /** ローカル正典に**新規に**追記された batch 数 */
  appended: number;
  /**
   * 新しく届いた分と手元の間で検出した競合 (step2 Phase 3 T5)。
   *
   * **implicit merge は止めない。**導出であって判断ではないので、競合があっても
   * 取り込みは続ける — 止めると「相手の編集が届かない」になる。競合は通知に回る。
   */
  conflicts: DetectedConflicts;
  /**
   * この受信で新しく書いた fork (step2 Phase 3 T6)。既にあったものは含まない。
   *
   * **競合の検出と fork の作成は同じ受信の中で完結する** — 検出時点の状態でしか
   * 理由を凍結できないからである。
   */
  forks: ForkMeta[];
};

/**
 * 名簿の参加者 (自分を除く) の repo を読み、**取り込んでよい batch を集める**。
 * **書き込まない。**
 *
 * 収集と追記を分けているのは、**書く前に見なければならない判断が 1 つある**ためである —
 * 発見経路 (`discoverParticipatingFiles`) は、引いた op-log に `file.remove` があれば
 * その File を materialize してはならない (ANA-127 の remove-wins)。書いてから消す形は
 * 取れない (ローカル正典から File を取り除く口が無く、削除は tombstone でしか表せない)。
 */
export async function collectParticipantBatches(
  fileId: FileId,
  participation: Participation,
  viewer: Did,
  deps: CollectParticipantDeps,
): Promise<CollectParticipantResult> {
  // **読む順序を名簿の反復順に依存させない。**誰の手元でも同じ結果になるべきで、
  // Set の反復順に結論が左右される形にしない (`readRoster` と同じ判断)
  const repos = [...participation.participating]
    .filter((did) => did !== viewer)
    .sort((a, b) => a.localeCompare(b));

  const result: CollectParticipantResult = {
    batches: [],
    readRepos: [],
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
    result.batches.push(...within);
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

/**
 * 参加者の repo から集めた batch をローカル正典へ取り込む。
 *
 * **1 回にまとめて書く。**repo ごとに書くと、1 サイクルの間にローカル正典が中途半端な
 * 状態を何度も通る。既読位置を持たないので、途中で落ちても次のサイクルが同じものを
 * もう一度読む。
 *
 * べき等: 同じ状態で 2 回呼んでも `appended` が 0 になるだけである。
 */
export async function receiveParticipantBatches(
  fileId: FileId,
  participation: Participation,
  viewer: Did,
  deps: ReceiveParticipantDeps,
): Promise<ReceiveParticipantResult> {
  const collected = await collectParticipantBatches(
    fileId,
    participation,
    viewer,
    deps,
  );
  const noConflicts: DetectedConflicts = {
    conflicts: [],
    labels: new Map(),
  };
  if (collected.batches.length === 0)
    return {
      ...collected,
      received: 0,
      appended: 0,
      conflicts: noConflicts,
      forks: [],
    };

  // **追記の前に検出する** (step2 Phase 3 T5)。分岐点は受信前の手元の状態なので、
  // 書いてからでは「私が見ていたグラフ」が失われる。
  //
  // 既読位置を持たない設計なので `collected.batches` は毎回全件である。**新しく
  // 届いた分だけ**を相手側にしないと、同じ batch が両側に居て自分自身との衝突を
  // 検出しうる。
  const local = await deps.fetchLocal(fileId);
  const known = new Set(local.map((b) => b.id));
  const incoming = collected.batches.filter((b) => !known.has(b.id));
  const conflicts = detectIncomingConflicts(local, incoming);

  // **保留の記録は検出と同じ受信の中で書く** (step2 Phase 3 T6)。理由は検出時点の状態で
  // しか凍結できない — 畳み直すと「今の競合」になるし、競合そのものが消えていることもある
  const forks = await writeForksForConflicts(
    {
      trunkFileId: fileId,
      detected: conflicts,
      localBatches: local,
      incoming,
      actor: viewer,
    },
    deps,
  );

  const appended = await deps.appendReceived(fileId, collected.batches);

  // 受信規則。**書き込みが成功してから前進させる** — 失敗して取り込めていないのに
  // clock だけ進むと、次に発番する batch が「取り込めなかった編集より後」を騙る
  deps.observeRemote(
    collected.batches.reduce((m, b) => Math.max(m, b.clock), 0),
  );

  return {
    ...collected,
    received: collected.batches.length,
    appended,
    conflicts,
    forks,
  };
}
