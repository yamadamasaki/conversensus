/**
 * discoverParticipatingFiles: 参加を承認した File を手元に立ち上げる (step2 Phase 2 S3)
 *
 * 設計: `deepse/plans/step2-phase2-sync.md` §1 事実 B /
 * スパイク: [u6-p1-report](../../../../deepse/spikes/u6-p1-report.md)
 *
 * `discoverRemoteFiles` (自分の repo のグラフ op-log から未知 File を拾う) と対になる、
 * **他 actor が作った File** の発見。承認しただけでは手元に File は無い — 判断ログには
 * 承認が載るが、グラフの batch は 1 件も自分の repo に無いからである。
 *
 * ## ⚠️ 他 actor の repo を列挙してはならない (U6-P1)
 *
 * 素朴には「参加者の repo に `listFileHeads` を回す」だが、これは**その actor の File が
 * 全部見える** (スパイクで実測 23 個)。`discoverRemoteFiles` は未知の fileId を新しい
 * File として materialize するので、そのまま繋ぐと**相手の無関係な File が自分の
 * サイドバーに並ぶ**。
 *
 * **列挙の入口を自分の repo にする**とこれが構造的に起きない。自分が関わる File には
 * 自分の repo に必ず判断ログがあるからである。
 *
 * | 立場 | 自分の repo にある判断 op |
 * | --- | --- |
 * | File を作った | `participation.genesis` |
 * | 参加を承認した | `participation.accept` |
 * | 誰かを依頼した (= 自分は参加者) | `participation.invite` |
 *
 * 判断ログの rkey は `batches` と同じスキーム (`v1~<fileId>~…`) なので、
 * `listJudgmentFileIds()` が自分の repo だけを読んで fileId の集合を返す。
 * **他人の repo は 1 件も列挙しない。**
 *
 * ## 名簿で確かめてからグラフを読む
 *
 * 列挙に出ただけでは足りない。判断ログには「依頼されたが承認していない」File も
 * 「離脱した」File も載る。**いま自分が参加者である File だけ**を立ち上げる。
 * これは絞り込みであると同時に、「読む順序は名簿 → グラフ」の実装でもある —
 * 誰の repo をどの期間読むかは、この名簿から決まる。
 *
 * ## 削除の扱い
 *
 * 引いた op-log に `file.remove` があれば materialize しない (ANA-127 の remove-wins)。
 * `discoverRemoteFiles` は列挙の着地レコードでも先に弾くが、ここは列挙が判断ログなので
 * その安い枝が無い。**引いてから見る 1 段だけ**になる。
 */

import {
  type Batch,
  type Did,
  type FileId,
  isFileDeleted,
  type Participation,
} from '@conversensus/shared';
import type { ReadRosterResult } from './readRoster';

export type DiscoverParticipatingDeps = {
  /** 自分の repo の判断ログにある fileId を列挙する (**他人の repo は読まない**) */
  listJudgmentFileIds: () => Promise<FileId[]>;
  /** ローカル既知の fileId 一覧 (削除済みも含む, ANA-127) */
  listLocalFileIds: () => Promise<FileId[]>;
  /** その File の名簿を読む (`rosterSource`) */
  readRoster: (fileId: FileId) => Promise<ReadRosterResult>;
  /**
   * 名簿の参加者 (自分を除く) の repo からグラフを集める
   * (`collectParticipantBatches`)。**書き込まない** — 削除の判定を書く前に挟むため。
   * 参加期間のフィルタはこの中にある
   */
  collectFromParticipants: (
    fileId: FileId,
    participation: Participation,
  ) => Promise<{ batches: Batch[] }>;
  /** ローカル正典へ受信追記する (marker を立てる経路であること) */
  appendReceived: (fileId: FileId, batches: Batch[]) => Promise<number>;
  /** この端末の DID。名簿に自分がいるかを見る */
  viewer: Did;
};

export type DiscoverParticipatingResult = {
  /** materialize した File */
  discovered: FileId[];
  /** ローカル正典へ新規追記された batch 数 (全 File の合計) */
  appended: number;
  /** 既知だったため触らなかった File 数 */
  skippedKnownFiles: number;
  /**
   * 判断ログには出るが**いま参加者ではない** File 数。
   * 依頼されただけ / 離脱済のどちらもここに入る。**異常ではない** — 依頼を断り続ける
   * 限りこの数は残る。
   */
  skippedNotParticipating: number;
  /** 削除されていたため materialize しなかった File 数 */
  skippedDeletedFiles: number;
  /** 名簿が読めなかった File と理由。**失敗で全体を止めない** */
  unreadable: { fileId: FileId; error: unknown }[];
};

/**
 * 自分の判断ログにあって手元に無い File のうち、いま参加しているものを立ち上げる。
 *
 * べき等: 2 回目は `listLocalFileIds` が 1 回目の結果を含むので何もしない。
 */
export async function discoverParticipatingFiles(
  deps: DiscoverParticipatingDeps,
): Promise<DiscoverParticipatingResult> {
  const [judgmentIds, localIds] = await Promise.all([
    deps.listJudgmentFileIds(),
    deps.listLocalFileIds(),
  ]);
  const known = new Set<FileId>(localIds);
  // 列挙の重複は防御的に落とす (順序は列挙のまま — 判断ログの rkey 順である)
  const candidates = [...new Set(judgmentIds)];
  const unknown = candidates.filter((fileId) => !known.has(fileId));

  const result: DiscoverParticipatingResult = {
    discovered: [],
    appended: 0,
    skippedKnownFiles: candidates.length - unknown.length,
    skippedNotParticipating: 0,
    skippedDeletedFiles: 0,
    unreadable: [],
  };

  for (const fileId of unknown) {
    let roster: ReadRosterResult;
    try {
      roster = await deps.readRoster(fileId);
    } catch (error) {
      result.unreadable.push({ fileId, error });
      continue;
    }

    // 依頼されただけ / 離脱済の File は立ち上げない。**読む資格が無い**のではなく、
    // 参加期間が 1 つも開いていないので読んでも全部落ちる
    if (!roster.participation.participating.has(deps.viewer)) {
      result.skippedNotParticipating += 1;
      continue;
    }

    const { batches } = await deps.collectFromParticipants(
      fileId,
      roster.participation,
    );
    // 名簿には載っているが、相手の repo が読めない・空だった場合。File を作らない
    if (batches.length === 0) continue;

    // **書く前に削除を見る** (ANA-127 の remove-wins)。書いてから消す形は取れない —
    // ローカル正典から File を取り除く口が無く、削除は tombstone でしか表せないので、
    // 「削除済みの File を作ってから削除し直す」ことになる。
    // `discoverRemoteFiles` にある「着地レコードが tombstone なら本体を引かない」という
    // 安い枝はここには無い (列挙が判断ログなので着地レコードを持たない)
    if (isFileDeleted(batches)) {
      result.skippedDeletedFiles += 1;
      continue;
    }

    result.appended += await deps.appendReceived(fileId, batches);
    result.discovered.push(fileId);
  }

  for (const { fileId, error } of result.unreadable) {
    console.warn(
      `[participation] ${fileId}: 名簿が読めず発見を見送った:`,
      error,
    );
  }
  return result;
}
