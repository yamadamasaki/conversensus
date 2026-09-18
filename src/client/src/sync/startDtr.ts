/**
 * 競合から DtR を起動する (step2 Phase 6 D1)
 *
 * 設計: `deepse/plans/step2-phase6-dtr.md`
 * 仕様: `deepse/requirements/spec/dialogueToResolveGraph.md`
 *
 * 仕様の 3 つの起動のうち、ここが担うのは **(1) explicit merge の content 競合からの
 * 強制起動**である。
 *
 * > 1. explicit merge で content に競合が生じた場合 → **強制的に起動**
 * > 2. explicit merge で structure に競合が生じた場合 → とりあえず merge されるが,
 * >    競合が通知されるので, **そこから手動で選択的に起動**
 *
 * **`requiresConfirmation` より狭い。**あちらは「取り込む前に人に問うか」(content +
 * structure) を判定するが、こちらは「自動で起動するか」なので content だけである。
 * 同じ 3 段の別の線であり、共有してはならない。
 *
 * ## merge を**適用した後**に起動する
 *
 * 仕様は DtR を「この競合を引き起こした merge 操作 (op-log) に」紐づけると定める。
 * Phase 3 の決定 ② により merge は押した時点で適用されるので、起動は適用の後になる。
 * 材料も先読み (`previewMerge`) ではなく**実際に適用した結果**を使う — 先読みと適用の
 * 間に trunk が動けば競合の件数は食い違いうる (`handleMergeBranch` が通知で既に
 * 同じ判断をしている)。
 *
 * ## 器は trunk の op-log に、判断は判断ログに
 *
 * dialogue graph の器 (sheet) は trunk の fileId の**中**に作る (U6 で確定。fileId を
 * 新たに切ると `discoverRemoteFiles` が File として materialize する)。一方、起動と
 * 承認は判断ログに書く — pre 条件を検証して捨てる意味論を持つからである。
 * **2 つのログにまたがる**ので、順序は「器を先、判断を後」にする。逆だと、器を指す
 * 判断だけが書かれて中身が無い瞬間が生まれる。
 *
 * **名簿の op と同じ batch に混ぜない** (設計 事実 B)。`recordToJudgmentBatch` は op が
 * 1 つでも語彙に合わなければ batch ごと捨てるので、混ぜると DtR を知らない版の手元で
 * 名簿の更新ごと失われる。`appendJudgment` に `dtr.*` だけを渡すことでこれを守る。
 */

import type {
  BranchId,
  Did,
  DtrId,
  FileId,
  JudgmentBatch,
  JudgmentOp,
  MergeConflict,
  SheetId,
} from '@conversensus/shared';

export type StartDtrDeps = {
  /**
   * resolve graph の器を作る (step2 Phase 6 D3)。trunk から branch を 1 本切る。
   *
   * **新しい merge 機構を作らないための選択である** — resolve graph は
   * 「競合を解消するために編集できる」= trunk の作業複製そのものなので、branch にすれば
   * 再 merge が既存の `mergeBranchOnOplog` で済む。
   */
  createResolveBranch: (params: {
    name: string;
    /** 分岐元のシート。branch は per-sheet なので、競合したシートから切る */
    sheetId: SheetId;
    trunkFileId: FileId;
  }) => Promise<BranchId>;
  /**
   * dialogue graph の器を trunk の op-log に作る。
   * `branchMetaRecorder` と同じく **trunk の tap の `record`** に流す口である。
   */
  recordSheetCreated: (sheetId: SheetId, name: string) => void;
  /**
   * 判断ログへ書く。**`dtr.*` だけを渡す** (名簿の op と混ぜない)。
   * `known` は clock の seed に要るので呼び出し側が束ねる。
   */
  appendJudgment: (
    fileId: FileId,
    ops: readonly JudgmentOp[],
  ) => Promise<JudgmentBatch>;
  newSheetId: () => SheetId;
  newDtrId: () => DtrId;
};

export type StartDtrInput = {
  /** DtR の器と判断ログの置き場。どちらも trunk の fileId に属する */
  trunkFileId: FileId;
  /** **実際に適用した** merge の競合 (先読みではない) */
  conflicts: readonly MergeConflict[];
  /** 起動の原因となった branch (fork もここに来る) */
  branchId: BranchId;
  /**
   * 競合が起きたシート。**解決 branch をここから切る** (branch は per-sheet)。
   * 原因の branch が対象にしていたシートと同じである
   */
  sourceSheetId: SheetId;
  /** 器の名前に使う。人が一覧で見分けるためだけの値である */
  branchName: string;
  /** 名簿の参加者。**既定値を供給するだけ**であって呼び出し対象そのものではない */
  participants: ReadonlySet<Did>;
  /** 起動した人の DID */
  viewer: Did;
};

export type StartedDtr = {
  dtrId: DtrId;
  /** dialogue graph の器 */
  sheetId: SheetId;
  /** resolve graph の器 (切った作業用 branch) */
  resolveBranchId: BranchId;
  callees: Did[];
};

/**
 * この競合の集合が DtR の**強制起動**を要するか。
 *
 * content だけを見る。structure は「とりあえず merge されるが, 競合が通知されるので,
 * そこから**手動で選択的に**起動」と仕様が定めており、自動で起動してはならない。
 * layout は DtR を起動しない段である。
 */
export function needsForcedStart(conflicts: readonly MergeConflict[]): boolean {
  return conflicts.some((conflict) => conflict.category === 'content');
}

/**
 * 呼び出し対象の既定値。explicit merge では**共同作業者全員**である (仕様)。
 *
 * **起動した本人を必ず含める。**名簿から引くので普通は含まれているが、含まれないまま
 * 起動すると起動した本人が呼び出し対象を変えられなくなる (`dtr.setCallees` の pre 条件は
 * 「発行者が呼び出し対象であること」)。**保留の出口を、開けた本人が使えなくなる。**
 * 判断ログのスキーマが空の集合を許さないことの担保にもなっている。
 */
export function defaultCallees(
  participants: ReadonlySet<Did>,
  viewer: Did,
): Did[] {
  return [...new Set<Did>([...participants, viewer])].sort();
}

/**
 * content 競合があれば DtR を起動する。
 *
 * @returns 起動したらその記録、起動が要らなければ `null`
 */
export async function startDtrForConflicts(
  input: StartDtrInput,
  deps: StartDtrDeps,
): Promise<StartedDtr | null> {
  if (!needsForcedStart(input.conflicts)) return null;

  const dtrId = deps.newDtrId();
  const sheetId = deps.newSheetId();
  const callees = defaultCallees(input.participants, input.viewer);

  // **器が先、判断が後。**逆だと器を指す判断だけが書かれた瞬間が生まれる。
  // 器は 2 つある (解決 = branch / 対話 = sheet) ので、両方を先に作る
  const resolveBranchId = await deps.createResolveBranch({
    name: `DtR 解決: ${input.branchName}`,
    sheetId: input.sourceSheetId,
    trunkFileId: input.trunkFileId,
  });
  deps.recordSheetCreated(sheetId, `DtR: ${input.branchName}`);
  await deps.appendJudgment(input.trunkFileId, [
    {
      kind: 'dtr.open',
      target: dtrId,
      branchId: input.branchId,
      resolveBranchId,
      sheetId,
      callees,
    },
  ]);

  return { dtrId, sheetId, resolveBranchId, callees };
}
