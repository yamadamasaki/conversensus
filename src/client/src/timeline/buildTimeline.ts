/**
 * version tree の中身を op-log から組み立てる (#73 timeline view, 計画 T1)
 *
 * 線は trunk と、出す branch (開いている・merge 済み, Q4) が 1 本ずつ。線の上の点は 2 種類ある
 * (仕様 timeline-view.md)。
 *
 * - **operation point**: 名前やコメントの付いた操作。trunk の上の分岐 (branch を作った点) と merge、
 *   branch の上の commit
 * - **change point**: op-log の batch 1 つ。operation point の間の続きは 1 つに畳む (Q2)
 *
 * 材料は trunk の op-log の畳み込み (`foldBranches`) と、各 branch の op-log だけである (計画 F1)。
 * 縦の順は op-log の順で、壁時計 (`timestamp`) は表示にだけ使う。
 *
 * **どの点も「その時点の切断面」を持つ** (計画 F3)。inspector の view graph はそれで開く。
 */

import {
  type Batch,
  BRANCH_STATUS,
  type BranchFold,
  type BranchId,
  type BranchMeta,
  COMMIT_KIND,
  type Commit,
  covers,
  isFork,
  orderBatches,
  type SheetId,
  type VersionVector,
} from '@conversensus/shared';

/** batch を書いた時点の姿の切断面: 書いた人が見ていたもの + その batch (計画 F3) */
export function cutOfBatch(batch: Batch): VersionVector {
  return { ...batch.deps, [batch.actor]: batch.seq };
}

/** change point。op-log の batch 1 つ */
export type ChangePoint = { batch: Batch; cut: VersionVector };

export type OperationPoint =
  /** trunk の上の分岐。branch を作った点 */
  | { kind: 'branch'; branch: BranchMeta; cut: VersionVector | null }
  /** branch の上の commit */
  | { kind: 'commit'; commit: Commit; cut: VersionVector | null }
  /** trunk の上の merge。どの branch を取り込んだか */
  | {
      kind: 'merge';
      commit: Commit;
      source: BranchMeta | null;
      cut: VersionVector | null;
    };

export type TimelineEntry =
  | { kind: 'operation'; point: OperationPoint }
  /** operation point の間の change point の続き (畳んで出す, Q2) */
  | { kind: 'changes'; points: ChangePoint[] };

export type TimelineLane = {
  /** trunk は null */
  branchId: BranchId | null;
  name: string;
  /** 開いている / merge 済み。trunk は null */
  status: BranchMeta['status'] | null;
  /** 上 (古い) から下 (新しい) へ */
  entries: TimelineEntry[];
};

/** 選んだ要素 (計画 F4)。渡せば、その要素に触れた change point だけを残す */
export type TimelineFocus = {
  nodeIds: ReadonlySet<string>;
  edgeIds: ReadonlySet<string>;
};

export type TimelineInput = {
  sheetId: SheetId;
  /** trunk の op-log */
  trunk: readonly Batch[];
  /** trunk の op-log の畳み込み */
  fold: BranchFold;
  /** 出す branch の op-log。無い branch は change point を持たない線になる */
  branchBatches: ReadonlyMap<BranchId, readonly Batch[]>;
  focus?: TimelineFocus;
};

export const TRUNK_LANE_NAME = 'trunk';

/** version tree に出す branch か (Q4: 開いている・merge 済み。fork は出さない) */
export function isShownBranch(branch: BranchMeta, sheetId: SheetId): boolean {
  return (
    branch.sheetId === sheetId &&
    !isFork(branch) &&
    (branch.status === BRANCH_STATUS.OPEN ||
      branch.status === BRANCH_STATUS.MERGED)
  );
}

/** batch が触れた node と edge */
export function touchedElements(batch: Batch): {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
} {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  for (const op of batch.ops) {
    if (!('target' in op) || typeof op.target !== 'string') continue;
    if (op.kind.startsWith('node.')) nodeIds.add(op.target);
    else if (op.kind.startsWith('edge.')) edgeIds.add(op.target);
  }
  return { nodeIds, edgeIds };
}

function touchesFocus(batch: Batch, focus: TimelineFocus | undefined): boolean {
  if (!focus) return true;
  const { nodeIds, edgeIds } = touchedElements(batch);
  for (const id of nodeIds) if (focus.nodeIds.has(id)) return true;
  for (const id of edgeIds) if (focus.edgeIds.has(id)) return true;
  return false;
}

/** グラフの中身を変える batch か (シートの名前・branch・commit などの器と意味論の op だけなら外す) */
function changesGraph(batch: Batch): boolean {
  return batch.ops.some(
    (op) => op.kind.startsWith('node.') || op.kind.startsWith('edge.'),
  );
}

/** operation point の Lamport (縦の順の鍵) */
function atOf(point: OperationPoint): number {
  return point.kind === 'branch' ? point.branch.base.at : point.commit.at;
}

/**
 * operation point と change point を 1 本の線に並べる。
 *
 * change point は「**その切断面に含まれる最初の operation point**」の前に置く。含まれなければ最後の
 * operation point の後に置く。切断面を持たない古い commit は、含むかどうかを決められないので
 * Lamport (`at`) と batch の clock で比べる
 */
function interleave(
  operations: OperationPoint[],
  changes: ChangePoint[],
): TimelineEntry[] {
  const ordered = [...operations].sort((a, b) => atOf(a) - atOf(b));
  const before = (change: ChangePoint, op: OperationPoint) =>
    op.cut
      ? covers(op.cut, change.batch.actor, change.batch.seq)
      : change.batch.clock <= atOf(op);
  const groups: ChangePoint[][] = ordered.map(() => []);
  const tail: ChangePoint[] = [];
  for (const change of changes) {
    const index = ordered.findIndex((op) => before(change, op));
    if (index === -1) tail.push(change);
    else groups[index]?.push(change);
  }
  const entries: TimelineEntry[] = [];
  ordered.forEach((point, i) => {
    const run = groups[i] ?? [];
    if (run.length > 0) entries.push({ kind: 'changes', points: run });
    entries.push({ kind: 'operation', point });
  });
  if (tail.length > 0) entries.push({ kind: 'changes', points: tail });
  return entries;
}

function changePointsOf(
  batches: readonly Batch[],
  accept: (batch: Batch) => boolean,
  focus: TimelineFocus | undefined,
): ChangePoint[] {
  return orderBatches([...batches])
    .filter((b) => accept(b) && changesGraph(b) && touchesFocus(b, focus))
    .map((batch) => ({ batch, cut: cutOfBatch(batch) }));
}

export function buildTimeline({
  sheetId,
  trunk,
  fold,
  branchBatches,
  focus,
}: TimelineInput): TimelineLane[] {
  const shown = [...fold.branches.values()].filter((b) =>
    isShownBranch(b, sheetId),
  );
  const shownIds = new Set(shown.map((b) => b.id));

  // trunk: 分岐と、このシートの branch の merge。merge の写し (`mergedIn`) は merge そのものなので
  // change point にしない
  const trunkOps: OperationPoint[] = [
    ...shown.map(
      (branch): OperationPoint => ({
        kind: 'branch',
        branch,
        cut: branch.base.vector ?? null,
      }),
    ),
    ...fold.trunkCommits
      .filter(
        (c) =>
          c.kind === COMMIT_KIND.MERGE &&
          c.sourceBranchId !== undefined &&
          shownIds.has(c.sourceBranchId),
      )
      .map(
        (commit): OperationPoint => ({
          kind: 'merge',
          commit,
          source: shown.find((b) => b.id === commit.sourceBranchId) ?? null,
          cut: commit.vector ?? null,
        }),
      ),
  ];
  const trunkLane: TimelineLane = {
    branchId: null,
    name: TRUNK_LANE_NAME,
    status: null,
    entries: interleave(
      trunkOps,
      changePointsOf(
        trunk,
        (b) => b.sheetId === sheetId && b.mergedIn === undefined,
        focus,
      ),
    ),
  };

  const branchLanes = shown.map(
    (branch): TimelineLane => ({
      branchId: branch.id,
      name: branch.name,
      status: branch.status,
      entries: interleave(
        (fold.branchCommits.get(branch.id) ?? [])
          .filter((c) => c.kind === COMMIT_KIND.COMMIT)
          .map((commit) => ({
            kind: 'commit',
            commit,
            cut: commit.vector ?? null,
          })),
        changePointsOf(
          branchBatches.get(branch.id) ?? [],
          (b) => b.sheetId === undefined || b.sheetId === sheetId,
          focus,
        ),
      ),
    }),
  );

  return [trunkLane, ...branchLanes];
}
