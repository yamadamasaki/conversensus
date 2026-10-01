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

import type { BranchId, CommitId, FileId, Sheet, SheetId } from '../schemas';
import { covers, heldMaxima, type VersionVector } from './causality';
import { projectBatches, toSheet } from './project';
import {
  type Batch,
  type BranchStatus,
  COMMIT_KIND,
  type CommitKind,
  type Lamport,
} from './unified';

/** コミット = 操作ログ上のラベル付きオフセット */
export type Commit = {
  id: CommitId;
  message: string;
  /**
   * このコミットが指すログ位置。clock <= at の batch を含む。
   * base コミットでは、切り出しの権威は `baseVector` の方にある (`at` は branch の発番の下限と表示に使う)
   */
  at: Lamport;
  authorActor: string;
  kind: CommitKind;
  /** 分岐点の vector (step3 Phase 1 D3)。base コミットだけが持つ (`makeBaseCommit`) */
  baseVector?: VersionVector;
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

/**
 * ブランチのメタ情報 = ドメインの `Branch` + 永続化・配線に要る補足。
 *
 * `Branch` はログドメインとして純粋 (base コミットのみ) だが、実配線では
 *   - `sheetId`: branch は per-sheet を維持する (設計 §9.5-1)
 *   - `trunkFileId`: どの trunk から分岐したか
 *   - `branchFileId`: branch batches を貯める専用 file_id (§3.1-B)。
 *     step1 では local 専用だった (§9.2) が、**step2 Phase 3 T7-2 で remote へ push する**
 *     ようになった。シートを持たないので File の一覧には出ない
 * が要る。ドメイン型を汚さずメタ側で補う。
 */
export type BranchMeta = Branch & {
  sheetId: SheetId;
  trunkFileId: FileId;
  branchFileId: FileId;
};

/** batches 中の最大 clock (= 現在のログ先端)。空なら 0 */
export function tipClock(batches: Batch[]): Lamport {
  return batches.reduce((max, b) => Math.max(max, b.clock), 0);
}

/**
 * 分岐点のコミットを作る (step3 Phase 1 D3)。`at` に加えて、**分岐した時点で actor ごとに
 * 持っていた最大の seq** (`baseVector`) を記録する。
 *
 * scalar の `at` で切ると、分岐時には持っていなかった batch が、clock が小さいというだけで
 * 後から base に入る (step3-entry §2.1)。vector で切れば、別の actor の batch が遅れて届いても
 * base は変わらない。
 *
 * - 「知っている範囲」(因果の知識) ではなく「持っていた範囲」を使うのは、base が分岐した人に
 *   **見えていたもの**でなければならないからである
 * - 「歯抜けなく持っていた範囲」(`contiguousFrontier`) にしないのは、歯抜けが恒久的に生じうる
 *   ため (`heldMaxima` の注)。残る穴は「同じ actor の歯抜けが分岐後に埋まる」場合だけで、
 *   同じ actor の batch は順に送られ順に読まれるので起きにくい
 */
export function makeBaseCommit(
  id: CommitId,
  message: string,
  authorActor: string,
  batches: Batch[],
): Commit {
  return {
    ...makeCommit(id, message, authorActor, batches),
    baseVector: heldMaxima(batches),
  };
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
  source: {
    branchId: BranchId;
    at: Lamport;
  },
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

/**
 * batch がそのコミット時点に含まれるか。`baseVector` があればそれに覆われるか
 * (step3 Phase 1 D3)、無ければ (branch の途中のコミットなど) clock <= at
 */
export function isUpTo(commit: Commit, batch: Batch): boolean {
  return commit.baseVector
    ? covers(commit.baseVector, batch.actor, batch.seq)
    : batch.clock <= commit.at;
}

/** コミット時点までの batches を切り出す (`isUpTo`) */
export function batchesUpTo(batches: Batch[], commit: Commit): Batch[] {
  return batches.filter((b) => isUpTo(commit, b));
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
