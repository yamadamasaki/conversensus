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
  joinVectors,
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

/** 要素の id の集まり (node と edge を分ける) */
export type ElementIds = { nodeIds: Set<string>; edgeIds: Set<string> };

/** operation point に共通の項目 (operation inspector が出す) */
type OperationCommon = {
  /** その時点の切断面。古い commit は持たない (view graph できない) */
  cut: VersionVector | null;
  /** その操作を運んだ batch の壁時計。op-log に見当たらなければ null */
  timestamp: number | null;
  /**
   * 関係する node/edge。commit は「1 つ前の operation point からの変更」が触れたもの、
   * merge は取り込んだ写しが触れたもの。分岐は持たない (空)
   */
  touched: ElementIds;
};

export type OperationPoint = OperationCommon &
  /** trunk の上の分岐。branch を作った点 */
  (
    | { kind: 'branch'; branch: BranchMeta }
    /** branch の上の commit */
    | { kind: 'commit'; commit: Commit }
    /** trunk の上の merge。どの branch を取り込んだか */
    | { kind: 'merge'; commit: Commit; source: BranchMeta | null }
  );

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
export function touchedElements(batch: Batch): ElementIds {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  for (const op of batch.ops) {
    if (!('target' in op) || typeof op.target !== 'string') continue;
    if (op.kind.startsWith('node.')) nodeIds.add(op.target);
    else if (op.kind.startsWith('edge.')) edgeIds.add(op.target);
  }
  return { nodeIds, edgeIds };
}

/** batch の並びが触れた node と edge を合わせる */
function touchedByAll(batches: Iterable<Batch>): ElementIds {
  const out: ElementIds = { nodeIds: new Set(), edgeIds: new Set() };
  for (const batch of batches) {
    const { nodeIds, edgeIds } = touchedElements(batch);
    for (const id of nodeIds) out.nodeIds.add(id);
    for (const id of edgeIds) out.edgeIds.add(id);
  }
  return out;
}

const NO_ELEMENTS = (): ElementIds => ({
  nodeIds: new Set(),
  edgeIds: new Set(),
});

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
  focus: TimelineFocus | undefined,
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
  // 絞る (focus) のは並べた後。commit の「関係する要素」は絞る前の変更から求める
  const visible = (run: ChangePoint[]) =>
    run.filter((c) => touchesFocus(c.batch, focus));
  const entries: TimelineEntry[] = [];
  ordered.forEach((point, i) => {
    const run = groups[i] ?? [];
    const shown = visible(run);
    if (shown.length > 0) entries.push({ kind: 'changes', points: shown });
    entries.push({
      kind: 'operation',
      point:
        point.kind === 'commit'
          ? { ...point, touched: touchedByAll(run.map((c) => c.batch)) }
          : point,
    });
  });
  const shownTail = visible(tail);
  if (shownTail.length > 0)
    entries.push({ kind: 'changes', points: shownTail });
  return entries;
}

function changePointsOf(
  batches: readonly Batch[],
  accept: (batch: Batch) => boolean,
): ChangePoint[] {
  return orderBatches([...batches])
    .filter((b) => accept(b) && changesGraph(b))
    .map((batch) => ({ batch, cut: cutOfBatch(batch) }));
}

/** operation の op を運んだ batch の壁時計。鍵は `branch:<id>` / `commit:<id>` */
function operationTimes(trunk: readonly Batch[]): Map<string, number> {
  const times = new Map<string, number>();
  for (const batch of trunk) {
    for (const op of batch.ops) {
      const key =
        op.kind === 'branch.create'
          ? `branch:${op.target}`
          : op.kind === 'commit.add'
            ? `commit:${op.commit.id}`
            : null;
      if (key && !times.has(key)) times.set(key, batch.timestamp);
    }
  }
  return times;
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

  const times = operationTimes(trunk);
  const timeOf = (key: string) => times.get(key) ?? null;

  // trunk: 分岐と、このシートの branch の merge。merge の写し (`mergedIn`) は merge そのものなので
  // change point にせず、merge の「関係する要素」にする
  const trunkOps: OperationPoint[] = [
    ...shown.map(
      (branch): OperationPoint => ({
        kind: 'branch',
        branch,
        cut: branch.base.vector ?? null,
        timestamp: timeOf(`branch:${branch.id}`),
        touched: NO_ELEMENTS(),
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
          timestamp: timeOf(`commit:${commit.id}`),
          touched: touchedByAll(trunk.filter((b) => b.mergedIn === commit.id)),
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
      ),
      focus,
    ),
  };

  const branchLanes = shown.map((branch): TimelineLane => {
    /**
     * branch の上の点の切断面には、分岐点の切断面を合わせる。branch の commit の vector は branch の
     * op-log だけから作られ (`makeCommit` の `heldMaxima(branchBatches)`)、trunk の actor (File を作った
     * genesis など) を含まない。そのまま切ると、trunk 側でシートそのものが切り落とされる
     * (App 結合で「その時点の姿が見つからない」として見つかった)
     */
    const base = branch.base.vector ?? {};
    const onBranch = (cut: VersionVector | undefined | null) =>
      cut ? joinVectors(base, cut) : null;
    return {
      branchId: branch.id,
      name: branch.name,
      status: branch.status,
      entries: interleave(
        (fold.branchCommits.get(branch.id) ?? [])
          .filter((c) => c.kind === COMMIT_KIND.COMMIT)
          .map(
            (commit): OperationPoint => ({
              kind: 'commit',
              commit,
              cut: onBranch(commit.vector),
              timestamp: timeOf(`commit:${commit.id}`),
              // 並べた後で、1 つ前の operation point からの変更で埋める (`interleave`)
              touched: NO_ELEMENTS(),
            }),
          ),
        changePointsOf(
          branchBatches.get(branch.id) ?? [],
          (b) => b.sheetId === undefined || b.sheetId === sheetId,
        ).map((c) => ({ ...c, cut: onBranch(c.cut) as VersionVector })),
        focus,
      ),
    };
  });

  return [trunkLane, ...branchLanes];
}
