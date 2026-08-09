/**
 * branchProjection: branch の作成と読取を op-log 上で成立させる調整層 (step1 Phase 5 p5-2)
 *
 * `receiveRemoteBatches.ts` と同型の**純粋な調整層** — React に依存せず、I/O は
 * すべて deps 経由。hook への載せ替えは p5-4、ここでは配線の中身だけを単体で固める。
 *
 * 置換するもの (設計 `step1-phase5-branch-oplog.md` §3.1/§3.4):
 *
 * - **branch 作成**: 旧 `createBranch` は trunk の全レコードを `{branchId}_` prefix で
 *   PDS へ複製していた (nodes/edges/layouts を 1 件ずつ put)。op-log では
 *   **複製を一切せず、分岐点を指す base コミット (ログ上のラベル付きオフセット) を
 *   記録するだけ**でよい。分岐時点の状態は trunk op-log を `clock <= base.at` で
 *   切り出せば再現できるため (`batchesUpTo`)。
 * - **branch 読取**: 旧 `fetchBranchSheetFromPds` は `{branchId}_` prefix のレコードを
 *   集めて Sheet を組み立てていた。op-log では
 *   `branchSheet(branch, trunkBatches, branchBatches, meta)` = 「base までの trunk」に
 *   「branch 側の追記」を重ねた projection で導出する。
 *
 * **branch batches は branch 専用 file_id の op-log に貯める** (§3.1-B)。この file_id は
 * **local 専用で remote へ push しない** (§9.2 の不変条件)。単一端末スコープなので
 * 決定論的な id 採番は不要で、無関係な UUID を採番して `branches.branch_file_id` で
 * 紐付ければよい (cross-device の dedup 都合は後続 phase)。
 *
 * ⚠️ **branch op-log へ構造 op (`sheet.create` 等) を流してはならない**。branch が
 * ファイル一覧に現れてしまう (p5-1 の `eventStore.test.ts` が条件ごと固定している)。
 * シートのメタは `branchSheet` の引数として与える設計。
 */

import {
  type Batch,
  BRANCH_STATUS,
  type BranchId,
  type BranchMeta,
  branchSheet,
  type CommitId,
  type FileId,
  type Lamport,
  makeCommit,
  type Sheet,
  type SheetId,
} from '@conversensus/shared';

export type BranchProjectionDeps = {
  /** file_id の op-log を取得する (trunk / branch とも同じ口) */
  fetchBatches: (fileId: FileId) => Promise<Batch[]>;
  /** branch メタを永続化する */
  saveBranch: (meta: BranchMeta) => Promise<BranchMeta>;
  /** id を採番する (branch id / base コミット id / branch 専用 file_id) */
  newId: () => string;
};

export type CreateBranchParams = {
  name: string;
  /** 分岐元のシート。branch は per-sheet を維持する (設計 §9.5-1) */
  sheetId: SheetId;
  /** 分岐元 trunk の file_id */
  trunkFileId: FileId;
  /** base コミットの作成者 (`did#deviceId`) */
  authorActor: string;
};

/** base コミットのラベル。ログ上のどの位置で分岐したかを人間に説明する */
const baseCommitMessage = (branchName: string): string =>
  `${branchName} の分岐点`;

/**
 * branch を作成する。**trunk の複製は行わない**。
 *
 * trunk op-log の先端を指す base コミットを作り、branch 専用 file_id を採番して
 * メタとして保存するだけ。branch の中身は「base までの trunk + これから branch 側に
 * 積まれる batch」として読取時に導出される。
 *
 * 作成しても **trunk op-log には 1 件も書かない** ため、trunk の projection は不変。
 */
export async function createBranchOnOplog(
  params: CreateBranchParams,
  deps: BranchProjectionDeps,
): Promise<BranchMeta> {
  const trunkBatches = await deps.fetchBatches(params.trunkFileId);
  // 分岐点 = 現在のログ先端 (tipClock)。以後 trunk が伸びても base は動かない
  const base = makeCommit(
    deps.newId() as CommitId,
    baseCommitMessage(params.name),
    params.authorActor,
    trunkBatches,
  );
  const meta: BranchMeta = {
    id: deps.newId() as BranchId,
    name: params.name,
    base,
    status: BRANCH_STATUS.OPEN,
    sheetId: params.sheetId,
    trunkFileId: params.trunkFileId,
    branchFileId: deps.newId() as FileId,
  };
  return deps.saveBranch(meta);
}

/** UI が同時に要る 4 つの時点 (p5-4, ANA-119 S6)。1 回の読取から導出する */
export type BranchSheets = {
  /** 現在の branch の内容 (branch batches を全部載せた projection) */
  current: Sheet;
  /** 分岐点 (base) 時点の内容 */
  base: Sheet;
  /** 直近コミット時点の内容。未コミット変更 (pendingChanges) の基準 */
  atLastCommit: Sheet;
  /**
   * 最後に merge した時点の内容。**次の merge の対象となる差分の基準** (ANA-119 S6)。
   * 一度も merge していなければ分岐点と同じなので, 呼び出し側は場合分けせずに使える。
   */
  atLastMerge: Sheet;
};

/**
 * branch の Sheet を op-log から導出する。
 *
 * @param sheetMeta シートの表示メタ。**branch op-log は `sheet.create` を持たない**ので
 *   projection からは得られず、呼び出し側 (trunk 側の現在のシートメタ) が与える。
 *   旧 `fetchBranchSheetFromPds` も sheet レコードは trunk のものを読んでいたので同義。
 */
export async function readBranchSheet(
  meta: BranchMeta,
  sheetMeta: { id: SheetId; name: string; description?: string },
  deps: BranchProjectionDeps,
): Promise<Sheet> {
  return (await readBranchSheets(meta, sheetMeta, deps)).current;
}

/**
 * branch の「現在 / 分岐点 / 直近コミット時点」を **1 回の読取から** 導出する (p5-4)。
 *
 * hook はこの 3 つを同時に要る (現在 = 画面、分岐点 = diff ハイライト、直近コミット =
 * 未コミット変更の判定)。旧経路はこれを PDS スナップショットの控えとして React state に
 * 抱えていたが、op-log では**すべて同じログの切り出し**なので保持しない。
 *
 * @param lastCommitAt 直近コミットが指すログ位置。コミットが無ければ省略 (= 分岐点)
 * @param lastMergeAt 最後の merge が取り込んだログ位置 (merge コミットの `sourceAt`)。
 *   未 merge なら省略 (= 分岐点)。**trunk 側の `at` ではない** — branch op-log の clock
 */
export async function readBranchSheets(
  meta: BranchMeta,
  sheetMeta: { id: SheetId; name: string; description?: string },
  deps: BranchProjectionDeps,
  options: { lastCommitAt?: Lamport; lastMergeAt?: Lamport } = {},
): Promise<BranchSheets> {
  const [trunkBatches, branchBatches] = await Promise.all([
    deps.fetchBatches(meta.trunkFileId),
    deps.fetchBatches(meta.branchFileId),
  ]);
  // 🔴 trunk op-log は**ファイル全体 (全シート)** のログなので、branch のシート分に絞る。
  // `branchSheet` → `projectBatches` は content op を sheetId で仕分けない (仕分けるのは
  // ファイル単位の `projectFile`) ため、絞らずに渡すと**他シートのノードが branch の
  // シートに現れる**。旧 `fetchBranchSheetFromPds` は sheet 参照でフィルタしていたので、
  // 絞らないと旧経路と一致しない。構造 batch は sheetId を持たないがここで落ちてよい
  // (`projectBatches` が file op を無視するので projection には元々効かない)。
  const trunkForSheet = trunkBatches.filter((b) => b.sheetId === meta.sheetId);
  // branch op-log は 1 branch = 1 シート専用だが、**配線の穴で別シートの batch が
  // 混ざりうる**ので同じくシートで絞る (混ざると他シートのノードが branch に現れ、
  // merge でそのまま trunk へ載る)。sheetId 無し (structure 経路) は残す —
  // 「絞りたいのは他シートの content」であって、文脈が無い batch を落とすことではない。
  const branchForSheet = branchBatches.filter(
    (b) => b.sheetId === undefined || b.sheetId === meta.sheetId,
  );
  // BranchMeta は Branch の上位型なのでそのまま渡せる (base/status を使う)
  const project = (batches: Batch[]) =>
    branchSheet(meta, trunkForSheet, batches, sheetMeta);
  // 分岐点 = branch batches を 1 件も載せない状態。branch の発番は base.at の後から
  // 始まる (`EventSyncTap.clockFloor`) ので、clock による切り出しでも同じ結果になる。
  const base = project([]);
  // 時点の切り出しはどれも同じ形 — 「その clock までの branch batch を載せた projection」。
  // 位置が無ければ分岐点そのもの (batch を 1 件も載せない) になる
  const projectUpTo = (at: Lamport | undefined): Sheet =>
    at === undefined
      ? base
      : project(branchForSheet.filter((b) => b.clock <= at));

  return {
    current: project(branchForSheet),
    base,
    atLastCommit: projectUpTo(options.lastCommitAt),
    atLastMerge: projectUpTo(options.lastMergeAt),
  };
}
