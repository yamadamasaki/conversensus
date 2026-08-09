import { describe, expect, it } from 'bun:test';
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
  LamportClock,
  type NodeId,
  type SheetId,
} from '@conversensus/shared';
import { type MergeBranchDeps, mergeBranchOnOplog } from './mergeBranch';

const TRUNK = 'trunk-file' as FileId;
const BRANCH_LOG = 'branch-file' as FileId;
const SHEET = 'sheet-1' as SheetId;
const ACTOR = 'did:plc:alice#dev-a';

const structure = (id: string, clock: number): Batch => ({
  id: id as Batch['id'],
  actor: 'genesis',
  clock,
  timestamp: clock,
  ops: [
    { kind: 'file.setName', name: 'ファイル' },
    { kind: 'sheet.create', target: SHEET, name: 'シート1' },
  ],
});

const content = (id: string, clock: number, ops: Batch['ops']): Batch => ({
  id: id as Batch['id'],
  actor: ACTOR,
  clock,
  timestamp: clock,
  ops,
  sheetId: SHEET,
});

const addNode = (node: string, text: string): Batch['ops'][number] => ({
  kind: 'node.add',
  target: node as NodeId,
  content: text,
});

const setContent = (node: string, text: string): Batch['ops'][number] => ({
  kind: 'node.setContent',
  target: node as NodeId,
  content: text,
});

/** base = clock 2 で分岐した open ブランチ */
const branchMeta = (): BranchMeta => ({
  id: 'branch-1' as BranchId,
  name: '案A',
  base: {
    id: 'commit-1' as CommitId,
    message: '案A の分岐点',
    at: 2,
    authorActor: ACTOR,
  },
  status: BRANCH_STATUS.OPEN,
  sheetId: SHEET,
  trunkFileId: TRUNK,
  branchFileId: BRANCH_LOG,
});

/** merge の記録に要る引数 (ANA-122)。理由は必須 */
const mergeParams = () => ({ message: '案A を取り込む', actor: ACTOR });

/**
 * file_id → op-log の簡易ストア。`appendBatches` は実際の EventStore と同じく
 * **batch id でべき等** (既存 id は無視して件数に数えない)。
 */
function makeDeps(logs: Record<string, Batch[]>, initialClock = 0) {
  const clock = new LamportClock(initialClock);
  const saved: BranchMeta[] = [];
  /** file_id ごとに保存されたコミット (merge の記録の宛先を検証する) */
  const commits: Record<string, Commit[]> = {};
  let idSeq = 0;
  const deps: MergeBranchDeps = {
    fetchBatches: async (fileId) => [...(logs[fileId] ?? [])],
    appendBatches: async (fileId, batches) => {
      const log = logs[fileId] ?? [];
      const known = new Set(log.map((b) => b.id));
      const fresh = batches.filter((b) => !known.has(b.id));
      logs[fileId] = [...log, ...fresh];
      return fresh.length;
    },
    saveBranch: async (meta) => {
      saved.push(meta);
      return meta;
    },
    saveCommit: async (fileId, commit) => {
      commits[fileId] = [...(commits[fileId] ?? []), commit];
      return commit;
    },
    newId: () => {
      idSeq += 1;
      return `merge-commit-${idSeq}`;
    },
    seedClock: (floor) => {
      clock.seed(floor);
    },
    tick: () => clock.tick(),
  };
  return { deps, saved, commits, logs, clock };
}

/** trunk: 分岐点まで (clock 1-2) + 分岐後の編集 (clock 3) */
const trunkLog = (): Batch[] => [
  structure('t1', 1),
  content('t2', 2, [addNode('n1', 'trunk ノード1')]),
  content('t3', 3, [setContent('n1', 'trunk による後発編集')]),
];

/** branch: 分岐後に branch 側で積まれた編集 */
const branchLog = (): Batch[] => [
  content('br1', 3, [setContent('n1', 'branch による編集')]),
  content('br2', 4, [addNode('n2', 'branch のノード')]),
];

const nodeContent = (trunk: GraphFile, nodeId: string) => {
  const sheet = trunk.sheets.find((s) => s.id === SHEET);
  return sheet?.nodes.find((n) => n.id === nodeId)?.content;
};

describe('mergeBranchOnOplog', () => {
  it('branch batches を trunk 先端の後へ再スタンプして追記する', async () => {
    const logs = { [TRUNK]: trunkLog(), [BRANCH_LOG]: branchLog() };
    const { deps } = makeDeps(logs);
    const result = await mergeBranchOnOplog(branchMeta(), mergeParams(), deps);

    expect(result.appended).toBe(2);
    // trunk 先端は clock 3。再スタンプは seed 意味論なのでちょうど 4, 5 になる
    const appended = (logs[TRUNK] ?? []).slice(3);
    expect(appended.map((b) => b.clock)).toEqual([4, 5]);
    // 元の相対順序 (br1 → br2) が保たれる
    expect(appended.map((b) => b.id)).toEqual(['br1', 'br2']);
  });

  it('batch の id は保持する (再 merge のべき等性の土台)', async () => {
    const logs = { [TRUNK]: trunkLog(), [BRANCH_LOG]: branchLog() };
    const { deps } = makeDeps(logs);
    await mergeBranchOnOplog(branchMeta(), mergeParams(), deps);
    // branch op-log 側は元の clock のまま残る (file_id が違うので両立する)
    expect((logs[BRANCH_LOG] ?? []).map((b) => b.clock)).toEqual([3, 4]);
  });

  it('timestamp は編集が起きた時刻のまま残す (順序付けは clock)', async () => {
    const logs = { [TRUNK]: trunkLog(), [BRANCH_LOG]: branchLog() };
    const { deps } = makeDeps(logs);
    await mergeBranchOnOplog(branchMeta(), mergeParams(), deps);
    const timestamps = (logs[TRUNK] ?? []).slice(3).map((b) => b.timestamp);
    expect(timestamps).toEqual([3, 4]);
  });

  it('trunkAfterBase は追記しない (mergeBranches の merged をそのまま使わない)', async () => {
    const logs = { [TRUNK]: trunkLog(), [BRANCH_LOG]: branchLog() };
    const { deps } = makeDeps(logs);
    await mergeBranchOnOplog(branchMeta(), mergeParams(), deps);
    // 3 (元の trunk) + 2 (branch) のみ。t3 が再スタンプされて二重に入っていない
    expect(logs[TRUNK]).toHaveLength(5);
    expect((logs[TRUNK] ?? []).filter((b) => b.id === 't3')).toHaveLength(1);
  });

  it('merge 後の trunk projection は branch の編集を含む', async () => {
    const logs = { [TRUNK]: trunkLog(), [BRANCH_LOG]: branchLog() };
    const { deps } = makeDeps(logs);
    const result = await mergeBranchOnOplog(branchMeta(), mergeParams(), deps);
    const sheet = result.trunk.sheets.find((s) => s.id === SHEET);
    expect(sheet?.nodes.map((n) => n.id).sort()).toEqual(['n1', 'n2']);
  });

  // 設計 §3.3-(i): branch が trunk の**上に乗る**。再スタンプで branch の clock が
  // trunk 後発編集より大きくなるので、LWW の畳み込みで branch が勝つ。
  it('branch の編集が trunk の後発編集に勝つ (再スタンプの帰結)', async () => {
    const logs = { [TRUNK]: trunkLog(), [BRANCH_LOG]: branchLog() };
    const { deps } = makeDeps(logs);
    const result = await mergeBranchOnOplog(branchMeta(), mergeParams(), deps);
    expect(nodeContent(result.trunk, 'n1')).toBe('branch による編集');
  });

  it('並行 content 変更を MergeConflict として検出する', async () => {
    const logs = { [TRUNK]: trunkLog(), [BRANCH_LOG]: branchLog() };
    const { deps } = makeDeps(logs);
    const result = await mergeBranchOnOplog(branchMeta(), mergeParams(), deps);
    expect(result.conflicts).toHaveLength(1);
    const conflict = result.conflicts[0];
    expect(conflict?.target).toBe('n1');
    expect(conflict?.category).toBe('content');
    expect(conflict?.ours.batchId).toBe('t3' as Batch['id']); // trunk 側
    expect(conflict?.theirs.batchId).toBe('br1' as Batch['id']); // branch 側
  });

  it('対立が無ければ conflicts は空', async () => {
    const logs = {
      [TRUNK]: [structure('t1', 1), content('t2', 2, [addNode('n1', 'A')])],
      [BRANCH_LOG]: [content('br1', 3, [addNode('n2', 'B')])],
    };
    const { deps } = makeDeps(logs);
    const result = await mergeBranchOnOplog(branchMeta(), mergeParams(), deps);
    expect(result.conflicts).toEqual([]);
  });

  it('branch の status を merged にする', async () => {
    const logs = { [TRUNK]: trunkLog(), [BRANCH_LOG]: branchLog() };
    const { deps, saved } = makeDeps(logs);
    const result = await mergeBranchOnOplog(branchMeta(), mergeParams(), deps);
    expect(result.branch.status).toBe(BRANCH_STATUS.MERGED);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.status).toBe(BRANCH_STATUS.MERGED);
  });

  // 🔴 M3 の核心。id を保持しているので 2 回目は appendBatch のべき等性で無視される。
  describe('べき等 (再 merge で二重適用しない)', () => {
    it('2 回目の merge は appended 0 で trunk を変えない', async () => {
      const logs = { [TRUNK]: trunkLog(), [BRANCH_LOG]: branchLog() };
      const { deps } = makeDeps(logs);
      await mergeBranchOnOplog(branchMeta(), mergeParams(), deps);
      const afterFirst = JSON.stringify(logs[TRUNK]);

      const second = await mergeBranchOnOplog(
        branchMeta(),
        mergeParams(),
        deps,
      );
      expect(second.appended).toBe(0);
      expect(JSON.stringify(logs[TRUNK])).toBe(afterFirst);
      // projection も不変
      expect(nodeContent(second.trunk, 'n1')).toBe('branch による編集');
    });

    it('再 merge では既に merge 済みの batch を対立として数え直さない', async () => {
      const logs = { [TRUNK]: trunkLog(), [BRANCH_LOG]: branchLog() };
      const { deps } = makeDeps(logs);
      await mergeBranchOnOplog(branchMeta(), mergeParams(), deps);
      const second = await mergeBranchOnOplog(
        branchMeta(),
        mergeParams(),
        deps,
      );
      // 載せるものが無いので新たな対立も無い (自分自身との突き合わせを作らない)
      expect(second.conflicts).toEqual([]);
    });

    it('merge 後に branch へ足した編集だけが次の merge で載る', async () => {
      const logs = { [TRUNK]: trunkLog(), [BRANCH_LOG]: branchLog() };
      const { deps } = makeDeps(logs);
      await mergeBranchOnOplog(branchMeta(), mergeParams(), deps);

      logs[BRANCH_LOG]?.push(content('br3', 5, [addNode('n3', '追加の編集')]));
      const second = await mergeBranchOnOplog(
        branchMeta(),
        mergeParams(),
        deps,
      );
      expect(second.appended).toBe(1);
      expect((logs[TRUNK] ?? []).at(-1)?.id).toBe('br3' as Batch['id']);
      const sheet = second.trunk.sheets.find((s) => s.id === SHEET);
      expect(sheet?.nodes.map((n) => n.id).sort()).toEqual(['n1', 'n2', 'n3']);
    });
  });

  it('branch 側に編集が無ければ追記せず status だけ更新する', async () => {
    const logs = { [TRUNK]: trunkLog(), [BRANCH_LOG]: [] };
    const { deps, saved } = makeDeps(logs);
    const result = await mergeBranchOnOplog(branchMeta(), mergeParams(), deps);
    expect(result.appended).toBe(0);
    expect(logs[TRUNK]).toHaveLength(3);
    expect(saved[0]?.status).toBe(BRANCH_STATUS.MERGED);
  });

  // clock が trunk 先端より**遅れている**ケースは他のテストが既定で通っている
  // (makeDeps の初期値 0 < trunk 先端 3)。seed が引き上げるので 4, 5 に載る。
  // ここは逆に**進んでいる**ケース: seed は下限を上げるだけなので clock を下げない。
  // 下げてしまうと既存 batch と clock が重なり、LWW の勝敗が id 順で決まってしまう。
  it('自端末 clock が trunk 先端より進んでいれば下げない', async () => {
    const logs = { [TRUNK]: trunkLog(), [BRANCH_LOG]: branchLog() };
    const { deps } = makeDeps(logs, 10);
    const result = await mergeBranchOnOplog(branchMeta(), mergeParams(), deps);
    expect((logs[TRUNK] ?? []).slice(3).map((b) => b.clock)).toEqual([11, 12]);
    expect(nodeContent(result.trunk, 'n1')).toBe('branch による編集');
  });

  /**
   * merge を一級の記録にする (ANA-122)。以前は branch の status が MERGED になるだけで、
   * 「いつ・誰が・何のために merge したか」がどこにも残らなかった。
   */
  describe('merge の記録', () => {
    it('trunk 側の commits に kind=merge として残る', async () => {
      const logs = { [TRUNK]: trunkLog(), [BRANCH_LOG]: branchLog() };
      const { deps, commits } = makeDeps(logs);
      const result = await mergeBranchOnOplog(
        branchMeta(),
        mergeParams(),
        deps,
      );

      expect(commits[TRUNK]).toHaveLength(1);
      const recorded = commits[TRUNK]?.[0];
      expect(recorded).toEqual(result.mergeCommit);
      expect(recorded?.kind).toBe(COMMIT_KIND.MERGE);
      expect(recorded?.message).toBe('案A を取り込む');
      expect(recorded?.authorActor).toBe(ACTOR);
      // branch 側の commits には書かない (merge は trunk の履歴に属する)
      expect(commits[BRANCH_LOG]).toBeUndefined();
    });

    it('at は追記後の trunk 先端、sourceAt は branch op-log の先端を指す', async () => {
      // 🔴 両者は**別系列の clock**。片方だけでは「trunk のどこに、branch のどこまでを」
      // 取り込んだかを復元できない。
      const logs = { [TRUNK]: trunkLog(), [BRANCH_LOG]: branchLog() };
      const { deps } = makeDeps(logs);
      const result = await mergeBranchOnOplog(
        branchMeta(),
        mergeParams(),
        deps,
      );

      expect(result.mergeCommit.at).toBe(5); // 再スタンプ後の trunk 先端 (4, 5)
      expect(result.mergeCommit.sourceAt).toBe(4); // branch 側の先端 (3, 4)
      expect(result.mergeCommit.sourceBranchId).toBe(branchMeta().id);
    });

    it('追記が 0 件でも記録は残る (merge した事実は起きている)', async () => {
      const logs = { [TRUNK]: trunkLog(), [BRANCH_LOG]: [] };
      const { deps, commits } = makeDeps(logs);
      const result = await mergeBranchOnOplog(
        branchMeta(),
        mergeParams(),
        deps,
      );

      expect(result.appended).toBe(0);
      expect(commits[TRUNK]).toHaveLength(1);
      // 載せたものが無いので trunk 先端は元のまま、branch 側は空なので 0
      expect(result.mergeCommit.at).toBe(3);
      expect(result.mergeCommit.sourceAt).toBe(0);
    });

    it('再 merge でも記録は 1 件ずつ増える', async () => {
      const logs = { [TRUNK]: trunkLog(), [BRANCH_LOG]: branchLog() };
      const { deps, commits } = makeDeps(logs);
      await mergeBranchOnOplog(branchMeta(), mergeParams(), deps);
      await mergeBranchOnOplog(branchMeta(), mergeParams(), deps);

      expect(commits[TRUNK]).toHaveLength(2);
      // id は採番のたびに変わるので、2 件が別の記録として残る
      expect(commits[TRUNK]?.[0]?.id).not.toBe(commits[TRUNK]?.[1]?.id);
    });
  });
});
