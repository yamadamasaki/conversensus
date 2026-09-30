/**
 * mergeBranch: branch を trunk へ merge する調整層 (step1 Phase 5 p5-3 / step3 Phase 1 S1-4)
 *
 * op-log では merge を「branch の batch を**写して** trunk 先端の後へ追記する」操作として
 * 表現する (設計 §3.3-(i))。branch が trunk の**上に乗る** — git の rebase に近い意味論で、
 * **merge した branch の編集は trunk の後発編集に勝つ**。
 *
 * 次の 3 つを引き受ける:
 *
 * - **写し方**: 写しは **merge した人自身の batch** である (step3 Phase 1 D2)。新しい id、
 *   merge した人の actor と点 (clock・seq・deps) を持ち、`copyOf` で元の batch の点を指す
 * - **べき等**: 同じ branch を 2 回 merge しても二重適用しない。trunk に既にある写しの
 *   `copyOf` の集合を見て、写し済みの元を落とす
 * - **再 projection**: 追記後の trunk を projection し直して返す
 *
 * ## なぜ写しを merge した人の batch にするか (step3 Phase 1 D2)
 *
 * step2 (T7-4) までは、写しが**書いた人の id と actor を保ち、clock だけを merge した人の
 * 発番器で振り直して**いた。因果の点 `(actor, seq)` を載せると、これは「書いた人の名前で
 * merge した人が番号を振る」ことになり、「actor の番号を振るのはその actor だけ」という
 * 前提が崩れる。写しを merge した人自身の batch にすると前提が守られ、参加期間の判定や
 * 送信の著者判定も actor を見るだけで済む (`copiesBy` / `stackedBy` が要らなくなった)。
 *
 * 2 人が並行に同じ branch を merge すると、同じ元を指す写しが 2 組できる。畳み込みは
 * 全順序で最初の写しだけを採る (`orderBatches`) ので、届いた順に依らず収束する。
 *
 * ## なぜ `mergeBranches` の `merged` をそのまま追記しないか
 *
 * `mergeBranches` が返す `merged` は `[...trunkAfterBase, ...branchBatches]` だが、
 * **`trunkAfterBase` は既に trunk op-log にある**。追記するのは branch の batch の写しだけで、
 * `mergeBranches` は対立の検出のために呼ぶ。
 */

import {
  type Batch,
  type BatchId,
  BRANCH_STATUS,
  type BranchId,
  type BranchMeta,
  type BranchStatus,
  type CausalClock,
  COMMIT_KIND,
  type Commit,
  type CommitId,
  copyKeyOf,
  type FileId,
  type GraphFile,
  type Lamport,
  type MergeConflict,
  makeMergeCommit,
  mergeBranches,
  type ProjectedGraph,
  projectBatches,
  projectFile,
  tipClock,
} from '@conversensus/shared';
import { labelsOfConflicts } from './conflicts';

/**
 * batch の「元」の点。写しの写し (branch に写しが載っていた) なら、その写しが指す元を返す —
 * 同じ編集の写しは何段写しても同じ元を指し、重複の判定がずれない
 */
function originOf(batch: Batch): { actor: string; seq: number } {
  return batch.copyOf ?? { actor: batch.actor, seq: batch.seq };
}

/** 先読み (`previewMerge`) に要るもの。**読むだけで何も書かない**ことを型で示す */
export type MergePreviewDeps = {
  /** file_id の op-log を取得する */
  fetchBatches: (fileId: FileId) => Promise<Batch[]>;
};

export type MergeBranchDeps = MergePreviewDeps & {
  /** trunk op-log へ追記する。@returns 新規に追記された件数 */
  appendBatches: (fileId: FileId, batches: Batch[]) => Promise<number>;
  /**
   * branch の status が変わったことを **trunk の op-log に記録する** (step2 Phase 3 T7-1)。
   * 以前は daemon の SQLite へ保存していた (`saveBranch`) が、それでは相手に届かない
   */
  recordStatus: (branchId: BranchId, status: BranchStatus) => void;
  /**
   * merge の記録を **trunk のコミットとして** op-log に残す (ANA-122, T7-1)。
   * 宛先の file_id を取らない — merge は trunk の履歴に属するので、branch 側に書く経路を作らない
   */
  recordCommit: (commit: Commit) => void;
  /** merge コミットと写しの id を採番する */
  newId: () => string;
  /**
   * trunk の因果の発番器 (step3 Phase 1)。**trunk の tap と同じものを渡す** — 写しは
   * merge した人自身の batch なので、その人の点を振る。別の発番器で振ると、tap が次に振る
   * 点と重なる
   */
  causal: CausalClock;
};

export type MergeBranchResult = {
  /** trunk op-log に新規追記された batch 数 (再 merge では 0) */
  appended: number;
  /** 検出された対立 (content / structure / layout) */
  conflicts: MergeConflict[];
  /**
   * 対立の対象の**分岐点での名前**。削除された要素は適用後のグラフに居ないので、
   * 通知が id しか出せなくなる (Phase 3 T4)
   */
  conflictLabels: Map<string, string>;
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

/** 先読みの結果。**op-log は一切変えていない** */
export type MergePreview = {
  /** この merge で起きる対立 */
  conflicts: MergeConflict[];
  /** trunk へ新しく載る batch の数 (再 merge では 0) */
  toAppendCount: number;
};

/** merge の計画。`previewMerge` と `mergeBranchOnOplog` が同じ手順で組む */
type MergePlan = {
  trunkBatches: Batch[];
  branchBatches: Batch[];
  /** まだ写していない branch の batch (写す前, clock 昇順) */
  toAppend: Batch[];
  conflicts: MergeConflict[];
  /** 分岐点のグラフ。競合の対象を名前で呼ぶのに要る */
  base: ProjectedGraph;
};

async function buildMergePlan(
  meta: BranchMeta,
  deps: MergePreviewDeps,
): Promise<MergePlan> {
  const [trunkBatches, branchBatches] = await Promise.all([
    deps.fetchBatches(meta.trunkFileId),
    deps.fetchBatches(meta.branchFileId),
  ]);

  // 既に写してある元は落とす (べき等)。trunk の写しの `copyOf` が「写し済みの元」の集合である
  const copied = new Set(
    trunkBatches.flatMap((b) => (b.copyOf ? [copyKeyOf(b.copyOf)] : [])),
  );
  // 元の clock 順を保って写す — branch 内部の相対順序は意味を持つ
  const toAppend = [...branchBatches]
    .filter((b) => !copied.has(copyKeyOf(originOf(b))))
    .sort((a, b) => a.clock - b.clock);

  // 対立検出は「分岐後に trunk 側で起きた変更」と「これから載せる branch の変更」の間で行う。
  // 既に merge 済みの batch を含めても自分自身と突き合わせるだけなので除いてある。
  const trunkAfterBase = trunkBatches.filter((b) => b.clock > meta.base.at);
  // **分岐点のグラフ**を渡す (Phase 3 T1)。削除のカスケードをこれに当てて「実際に
  // 消える要素」を求めないと、グループ削除で子への依存を取り逃す
  const base = projectBatches(
    trunkBatches.filter((b) => b.clock <= meta.base.at),
  );
  const { conflicts } = mergeBranches(base, trunkAfterBase, toAppend);
  return { trunkBatches, branchBatches, toAppend, conflicts, base };
}

/**
 * merge を**適用せずに**何が起きるかだけを求める (Phase 3 T1)。
 *
 * merge は不可逆である — trunk op-log への追記に revert の経路は無い。人が押す操作の
 * 前に、content / structure の対立を見せるためにこれを使う (`requiresConfirmation`)。
 *
 * **結果は助言であって保証ではない。**先読みと適用の間に trunk は動きうるので、
 * `mergeBranchOnOplog` は読み直して計画を組み直す。ここで 0 件でも適用時に対立が
 * 出ることはある (逆もある)。
 */
export async function previewMerge(
  meta: BranchMeta,
  deps: MergePreviewDeps,
): Promise<MergePreview> {
  const { toAppend, conflicts } = await buildMergePlan(meta, deps);
  return { conflicts, toAppendCount: toAppend.length };
}

/**
 * branch を trunk へ merge する。
 *
 * べき等: 同じ状態で 2 回呼んでも `appended` が 0 になるだけで trunk は変わらない。
 * ただし**merge の記録は毎回残る** — 「いつ・誰が・何のために merge したか」は
 * 追記が 0 件でも起きた事実だからである。
 *
 * **確認は挟まない。**止めるかどうかは呼び出し側の判断である — explicit merge は
 * `previewMerge` で先に問い、implicit merge (Phase 3 T5) は止めずに常に適用する。
 */
export async function mergeBranchOnOplog(
  meta: BranchMeta,
  params: MergeBranchParams,
  deps: MergeBranchDeps,
): Promise<MergeBranchResult> {
  const { trunkBatches, branchBatches, toAppend, conflicts, base } =
    await buildMergePlan(meta, deps);

  // 発番器を trunk と branch の両方のログに追随させる。trunk 先端まで clock を進めないと
  // 写しが trunk の下に潜り込み「上に乗る」不変条件が壊れる。branch を知識に入れるのは、
  // 写しの deps が元の batch (とその依存) を含むようにするため — 写しは元を見てから書かれた
  deps.causal.restore(trunkBatches);
  deps.causal.restore(branchBatches);
  // merge コミットの id を先に採る。写しに「どの merge の写しか」を持たせるため (T7-4)
  const mergeCommitId = deps.newId() as CommitId;
  const copies: Batch[] = toAppend.map((batch) => {
    const { copyOf: _nested, mergedIn: _previous, ...content } = batch;
    return {
      ...content,
      // 写しは merge した人自身の batch (step3 Phase 1 D2)。id も点も新しく振る
      id: deps.newId() as BatchId,
      actor: params.actor,
      ...deps.causal.issue(),
      // timestamp は表示用なので編集が起きた時刻のまま残す (順序付けは clock→actor→id, 4d-3)
      copyOf: originOf(batch),
      mergedIn: mergeCommitId,
    };
  });

  const appended =
    copies.length > 0 ? await deps.appendBatches(meta.trunkFileId, copies) : 0;

  deps.recordStatus(meta.id, BRANCH_STATUS.MERGED);
  const branch: BranchMeta = { ...meta, status: BRANCH_STATUS.MERGED };

  // merge を trunk 側の一級の記録として残す (ANA-122)。commit と同じ「ラベル付き
  // オフセット」の形なので、trunk の履歴から commit と merge を一列に引ける。
  // `at` は追記後の trunk 先端、`sourceAt` は取り込んだ branch op-log の先端 —
  // **両者は別系列の clock** なので片方だけでは merge 位置を復元できない。
  // `at` は記録の batch を積む**前**に求める。記録そのものは file 構造の op なので
  // グラフの位置には数えない。
  const mergeCommit = makeMergeCommit(
    mergeCommitId,
    params.message,
    params.actor,
    [...trunkBatches, ...copies],
    {
      branchId: meta.id,
      at: tipClock(branchBatches),
    },
  );
  deps.recordCommit(mergeCommit);

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

  return {
    appended,
    conflicts,
    conflictLabels: labelsOfConflicts(base, conflicts),
    trunk,
    branch,
    mergeCommit,
  };
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
