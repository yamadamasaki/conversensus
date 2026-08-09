/**
 * ブランチ/コミットのログドメイン (step1 Phase 2)
 *
 * O3 spike の Go 判定に基づく再定義:
 *   - コミット = 操作ログ上の**ラベル付きオフセット** (どの clock までを含むか)
 *   - ブランチ = base コミット + そのブランチで追記された batches
 *   - ブランチの sheet = base までの trunk batches + branch batches の projection
 *
 * 旧 `branchState.ts` の rkey 複製方式 (createMainBranch/createBranch/
 * fetchBranchSheetFromPds/mergeBranchToTrunk 等) のドメイン概念を置換したもの。
 * **置換は完了し、旧方式は Phase 6 p6-5b で退役した** (client 側の配線は Phase 5)。
 */

import { z } from 'zod';
import {
  type BranchId,
  BranchIdSchema,
  type CommitId,
  CommitIdSchema,
  type FileId,
  FileIdSchema,
  type Sheet,
  type SheetId,
  SheetIdSchema,
} from '../schemas';
import { projectBatches, toSheet } from './project';
import type { Batch, Lamport } from './unified';

export const BRANCH_STATUS = {
  CREATING: 'creating',
  OPEN: 'open',
  MERGED: 'merged',
  CLOSED: 'closed',
} as const;
export type BranchStatus = (typeof BRANCH_STATUS)[keyof typeof BRANCH_STATUS];

/**
 * コミットの種別 (ANA-122)。**merge も一級の記録**にするための区別。
 *
 * merge は「branch batches を trunk 先端の後へ再スタンプして追記する」操作なので、
 * 追記後の trunk 先端を指すオフセットとして commit と同じ形で表せる。種別を分けるのは
 * 「いつ・誰が・何のために merge したか」を trunk の履歴から commit と一列に引くため。
 */
export const COMMIT_KIND = {
  COMMIT: 'commit',
  MERGE: 'merge',
} as const;
export type CommitKind = (typeof COMMIT_KIND)[keyof typeof COMMIT_KIND];

/** コミット = 操作ログ上のラベル付きオフセット */
export type Commit = {
  id: CommitId;
  message: string;
  /** このコミットが指すログ位置。clock <= at の batch を含む */
  at: Lamport;
  authorActor: string;
  kind: CommitKind;
  /** merge のとき、取り込んだ branch。commit では持たない */
  sourceBranchId?: BranchId;
  /**
   * merge のとき、**branch op-log 側のどこまでを取り込んだか**。`at` は trunk 側の
   * 位置なので、branch 側の位置は別に持たないと後から辿れない (両者は別の file_id の
   * ログで clock も別系列)。「最後の merge 以降に branch へ積まれた commit があるか」は
   * これで判定できる。
   */
  sourceAt?: Lamport;
};

/** ブランチ = base コミットからの分岐 */
export type Branch = {
  id: BranchId;
  name: string;
  base: Commit;
  status: BranchStatus;
};

// --- API 境界のバリデーション用スキーマ (step1 Phase 5) ---
//
// ドメイン型 (`Commit` / `BranchMeta`) は上の手書き定義を正とし、スキーマは
// HTTP 境界で外来 JSON を検証するための対 (CLAUDE.md 規約 2)。両者の乖離は
// `parse` の結果をドメイン型の引数へ渡す呼び出し側 (server の saveCommit /
// saveBranch) でコンパイル時に検出される。

export const CommitSchema = z.object({
  id: CommitIdSchema,
  message: z.string(),
  at: z.number().int().nonnegative(),
  authorActor: z.string(),
  // 既定値を持たせるのは互換のため — `kind` を持たない既存のコミット行や、
  // branches テーブルへ列展開されている base コミット (種別を持たない) が
  // そのまま通る。出力側では必須なのでドメイン型 `Commit` と一致する。
  kind: z.nativeEnum(COMMIT_KIND).default(COMMIT_KIND.COMMIT),
  sourceBranchId: BranchIdSchema.optional(),
  sourceAt: z.number().int().nonnegative().optional(),
});

/**
 * ブランチのメタ情報 = ドメインの `Branch` + 永続化・配線に要る補足。
 *
 * `Branch` はログドメインとして純粋 (base コミットのみ) だが、実配線では
 *   - `sheetId`: branch は per-sheet を維持する (設計 §9.5-1)
 *   - `trunkFileId`: どの trunk から分岐したか
 *   - `branchFileId`: branch batches を貯める専用 file_id (§3.1-B)。
 *     **local 専用で remote へ push しない** (§9.2 の不変条件)
 * が要る。ドメイン型を汚さずメタ側で補う。
 */
export type BranchMeta = Branch & {
  sheetId: SheetId;
  trunkFileId: FileId;
  branchFileId: FileId;
};

export const BranchMetaSchema = z.object({
  id: BranchIdSchema,
  name: z.string(),
  base: CommitSchema,
  // BRANCH_STATUS の定数と機械的に同期させる (値の二重定義を作らない)
  status: z.nativeEnum(BRANCH_STATUS),
  sheetId: SheetIdSchema,
  trunkFileId: FileIdSchema,
  branchFileId: FileIdSchema,
});

/** batches 中の最大 clock (= 現在のログ先端)。空なら 0 */
export function tipClock(batches: Batch[]): Lamport {
  return batches.reduce((max, b) => Math.max(max, b.clock), 0);
}

/** 現在のログ先端にラベル付きコミット (オフセット) を作る */
export function makeCommit(
  id: CommitId,
  message: string,
  authorActor: string,
  batches: Batch[],
): Commit {
  return {
    id,
    message,
    at: tipClock(batches),
    authorActor,
    kind: COMMIT_KIND.COMMIT,
  };
}

/**
 * merge の記録を作る (ANA-122)。**trunk 側**のコミットである。
 *
 * @param trunkBatches merge 追記**後**の trunk op-log。`at` はその先端を指す
 * @param source 取り込んだ branch と、branch op-log 側の取り込み位置
 */
export function makeMergeCommit(
  id: CommitId,
  message: string,
  authorActor: string,
  trunkBatches: Batch[],
  source: { branchId: BranchId; at: Lamport },
): Commit {
  return {
    id,
    message,
    at: tipClock(trunkBatches),
    authorActor,
    kind: COMMIT_KIND.MERGE,
    sourceBranchId: source.branchId,
    sourceAt: source.at,
  };
}

/** base コミット時点までの batches (clock <= base.at) を切り出す */
export function batchesUpTo(batches: Batch[], commit: Commit): Batch[] {
  return batches.filter((b) => b.clock <= commit.at);
}

/**
 * ブランチの sheet を導出する。
 * base 時点の trunk batches に、ブランチ側 batches を重ねて projection する。
 */
export function branchSheet(
  branch: Branch,
  trunkBatches: Batch[],
  branchBatches: Batch[],
  meta: { id: SheetId; name: string; description?: string },
): Sheet {
  const base = batchesUpTo(trunkBatches, branch.base);
  return toSheet(projectBatches([...base, ...branchBatches]), meta);
}
