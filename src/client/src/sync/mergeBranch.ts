/**
 * mergeBranch: branch を trunk へ merge する調整層 (step1 Phase 5 p5-3)
 *
 * 旧 `mergeBranchToTrunk` の**レコード書替**を置換する。op-log では merge を
 * 「branch batches を trunk 先端の後へ再スタンプして trunk op-log へ追記する」
 * 操作として表現する (設計 §3.3-(i))。branch が trunk の**上に乗る** — git の rebase に
 * 近い意味論で、**merge した branch の編集は trunk の後発編集に勝つ**。
 *
 * 設計 M3 の中間層として次の 3 つを引き受ける:
 *
 * - **採番規約**: clock は再スタンプするが **batch の id は保持する** (下記)。
 * - **べき等**: 同じ branch を 2 回 merge しても二重適用しない。
 * - **再 projection**: 追記後の trunk を projection し直して返す。
 *
 * ## なぜ `mergeBranches` の `merged` をそのまま追記しないか
 *
 * `mergeBranches` が返す `merged` は `[...trunkAfterBase, ...branchBatches]` だが、
 * **`trunkAfterBase` は既に trunk op-log にある**。これを含めて追記すると、id を保てば
 * `UNIQUE(file_id, batch_id)` で無視されて再スタンプが効かず、id を振り直せば
 * 二重適用になる。→ **追記するのは branch batches だけ**。`mergeBranches` は
 * content 対立の検出のために呼ぶ。
 *
 * ## なぜ id を保持するか (採番規約の確定, 設計 §3.3 / §9.2)
 *
 * 保持すると**再 merge のべき等性が構造的に得られる** — 既に merge 済みの batch は
 * 同じ id で trunk に居るので、2 回目は `appendBatch` のべき等性で無視される。
 * 新規採番すると branch の status フラグに頼ることになり、フラグ更新に失敗した瞬間に
 * 二重適用する。単一端末スコープでは remote の rkey 衝突懸念が消えている (§9.2 の
 * 不変条件で C1 解消済) ので、保持を妨げる理由が無い。
 *
 * branch op-log 側には元の clock のまま残り、trunk 側には再スタンプ後の clock で入る。
 * file_id が違うので `UNIQUE(file_id, batch_id)` とも両立する。
 */

import {
  type Batch,
  BRANCH_STATUS,
  type BranchId,
  type BranchMeta,
  COMMIT_KIND,
  type Commit,
  type CommitId,
  type FileId,
  type GraphFile,
  type Lamport,
  type MergeConflict,
  makeMergeCommit,
  mergeBranches,
  projectFile,
  tipClock,
} from '@conversensus/shared';

export type MergeBranchDeps = {
  /** file_id の op-log を取得する */
  fetchBatches: (fileId: FileId) => Promise<Batch[]>;
  /** trunk op-log へ追記する。@returns 新規に追記された件数 */
  appendBatches: (fileId: FileId, batches: Batch[]) => Promise<number>;
  /** branch メタを保存する (status を merged にする) */
  saveBranch: (meta: BranchMeta) => Promise<BranchMeta>;
  /** merge の記録を trunk 側へ保存する (ANA-122) */
  saveCommit: (fileId: FileId, commit: Commit) => Promise<Commit>;
  /** merge コミットの id を採番する */
  newId: () => string;
  /**
   * 自端末 clock の下限を引き上げる (`LamportClock.seed` 相当)。再スタンプの起点を
   * trunk 先端に合わせるため、**`observe` ではなく `seed` の意味論** — `+1` しないので
   * 直後の `tick()` がちょうど「trunk 先端の次」になる。
   */
  seedClock: (floor: Lamport) => void;
  /** 次の clock を発番する */
  tick: () => Lamport;
};

export type MergeBranchResult = {
  /** trunk op-log に新規追記された batch 数 (再 merge では 0) */
  appended: number;
  /** 検出された content 対立 (検出のみ。可視化は後続 phase) */
  conflicts: MergeConflict[];
  /**
   * 追記後に projection し直した trunk。**再 projection に失敗したときは undefined** —
   * merge 自体 (追記 + status 更新) は成功しているので、ここでの失敗を merge の
   * 失敗として扱わせないための区別。
   */
  trunk: GraphFile | undefined;
  /** merged 済みに更新した branch メタ */
  branch: BranchMeta;
  /** trunk 側に残した merge の記録 (ANA-122) */
  mergeCommit: Commit;
};

/** merge それ自体の記録に要るもの (ANA-122)。理由は commit と同様に必須 */
export type MergeBranchParams = {
  /** 何のために merge したか。空文字は呼び出し側で弾く */
  message: string;
  /** merge を実行した操作主体 `<did>#<deviceId>` */
  actor: string;
};

/**
 * branch を trunk へ merge する。
 *
 * べき等: 同じ状態で 2 回呼んでも `appended` が 0 になるだけで trunk は変わらない。
 * ただし**merge の記録は毎回残る** — 「いつ・誰が・何のために merge したか」は
 * 追記が 0 件でも起きた事実だからである。
 */
export async function mergeBranchOnOplog(
  meta: BranchMeta,
  params: MergeBranchParams,
  deps: MergeBranchDeps,
): Promise<MergeBranchResult> {
  const [trunkBatches, branchBatches] = await Promise.all([
    deps.fetchBatches(meta.trunkFileId),
    deps.fetchBatches(meta.branchFileId),
  ]);

  // 既に trunk に居る batch は落とす (id 保持がここでべき等性になる)。
  const trunkIds = new Set(trunkBatches.map((b) => b.id));
  // 元の clock 順を保って再スタンプする — branch 内部の相対順序は意味を持つ
  const toAppend = [...branchBatches]
    .filter((b) => !trunkIds.has(b.id))
    .sort((a, b) => a.clock - b.clock);

  // 対立検出は「分岐後に trunk 側で起きた変更」と「これから載せる branch の変更」の間で行う。
  // 既に merge 済みの batch を含めても自分自身と突き合わせるだけなので除いてある。
  const trunkAfterBase = trunkBatches.filter((b) => b.clock > meta.base.at);
  const { conflicts } = mergeBranches(trunkAfterBase, toAppend);

  // 再スタンプの起点を trunk 先端まで進める。自端末 clock が trunk より遅れていると
  // (別経路の受信などで) branch が trunk の下に潜り込み「上に乗る」不変条件が壊れる。
  deps.seedClock(tipClock(trunkBatches));
  const restamped: Batch[] = toAppend.map((batch) => ({
    ...batch,
    // timestamp は表示用なので編集が起きた時刻のまま残す (順序付けは clock→actor→id, 4d-3)
    clock: deps.tick(),
  }));

  const appended =
    restamped.length > 0
      ? await deps.appendBatches(meta.trunkFileId, restamped)
      : 0;

  const branch = await deps.saveBranch({
    ...meta,
    status: BRANCH_STATUS.MERGED,
  });

  // merge を trunk 側の一級の記録として残す (ANA-122)。commit と同じ「ラベル付き
  // オフセット」の形なので、trunk の履歴から commit と merge を一列に引ける。
  // `at` は追記後の trunk 先端、`sourceAt` は取り込んだ branch op-log の先端 —
  // **両者は別系列の clock** なので片方だけでは merge 位置を復元できない。
  const mergeCommit = await deps.saveCommit(
    meta.trunkFileId,
    makeMergeCommit(
      deps.newId() as CommitId,
      params.message,
      params.actor,
      [...trunkBatches, ...restamped],
      { branchId: meta.id, at: tipClock(branchBatches) },
    ),
  );

  // 再 projection: 追記後の trunk を読み直して畳む (畳み込みの第 2 実装を作らない)。
  // **ここでの失敗は merge の失敗ではない** — 追記も status 更新も既に成功している。
  // 呼び出し側が「merge に失敗しました」と誤って伝えないよう、trunk を返さない形に
  // 落として成功を通す (画面の再描画はファイルを開き直せば回復する)。
  let trunk: GraphFile | undefined;
  try {
    trunk = projectFile(
      await deps.fetchBatches(meta.trunkFileId),
      meta.trunkFileId,
    );
  } catch (error) {
    console.warn('[branch] merge 後の trunk 再 projection に失敗:', error);
  }

  return { appended, conflicts, trunk, branch, mergeCommit };
}

/**
 * trunk の履歴から, この branch を**最後に merge した時点**を求める (ANA-119 S6)。
 *
 * 返すのは **branch op-log 側の clock** (`sourceAt`) — merge コミットの `at` は trunk 側の
 * 位置なので, branch の切り出しには使えない。一度も merge されていなければ undefined。
 *
 * これがあると「merge 済み branch を再オープンしたときの起点」をログから導ける。
 * 以前はセッション内の ref (`mergedCommitCounts`) に頼っていたので, アプリを開き直すと
 * merge 済みの内容まで差分に出ていた。
 *
 * 同じ branch を 2 回以上 merge していることがあるので**最大の `sourceAt`** を採る
 * (配列の順序に依存しない)。
 */
export function lastMergeSourceAt(
  trunkCommits: Commit[],
  branchId: BranchId,
): Lamport | undefined {
  let last: Lamport | undefined;

  for (const commit of trunkCommits) {
    if (commit.kind !== COMMIT_KIND.MERGE) continue;
    if (commit.sourceBranchId !== branchId) continue;
    if (commit.sourceAt === undefined) continue;
    if (last === undefined || commit.sourceAt > last) last = commit.sourceAt;
  }

  return last;
}

/**
 * `at` より後に積まれたコミットの数。`at` が無ければ (= 未 merge) 全件。
 *
 * 「前回 merge 以降に commit があるか」= 次の merge の対象があるか, の判定に使う。
 */
export function countCommitsAfter(
  commits: Commit[],
  at: Lamport | undefined,
): number {
  if (at === undefined) return commits.length;
  return commits.filter((c) => c.at > at).length;
}
