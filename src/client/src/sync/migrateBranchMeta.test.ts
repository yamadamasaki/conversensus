import { describe, expect, it } from 'bun:test';
import {
  type Actor,
  type Batch,
  BRANCH_STATUS,
  type BranchId,
  type BranchMeta,
  type BranchStatus,
  COMMIT_KIND,
  type Commit,
  type CommitId,
  type FileId,
  foldBranches,
  type SheetId,
} from '@conversensus/shared';
import fc from 'fast-check';
import { graphEventToBatch } from '../events/toUnified';
import { branchMetaRecorder } from './branchMetaLog';
import {
  applyBranchMetaMigration,
  migrateBranchMeta,
  planBranchMetaMigration,
} from './migrateBranchMeta';

const TRUNK = '11111111-1111-4111-8111-111111111111' as FileId;
const SHEET = '22222222-2222-4222-8222-222222222222' as SheetId;
const ACTOR = 'did:plc:alice#dev-a' as Actor;

/** 決まった番号から UUID を作る (同じ番号は同じ id) */
const id = (n: number) =>
  `${n.toString(16).padStart(8, '0')}-3333-4333-8333-333333333333`;

const commit = (n: number, at: number, over: Partial<Commit> = {}): Commit => ({
  id: id(n) as CommitId,
  kind: COMMIT_KIND.COMMIT,
  message: `commit ${n}`,
  at,
  authorActor: ACTOR,
  ...over,
});

/** SQLite の branch 行 (T7-1 以前の形) */
const legacyBranch = (
  n: number,
  status: BranchStatus = BRANCH_STATUS.OPEN,
): BranchMeta => ({
  id: id(100 + n) as BranchId,
  name: `branch ${n}`,
  base: commit(200 + n, 2),
  status,
  sheetId: SHEET,
  trunkFileId: TRUNK,
  branchFileId: id(300 + n) as FileId,
});

/** 記録口で書いたものを trunk の batch にする (本物の経路: 記録口 → graphEventToBatch) */
function recordingLog(initial: readonly Batch[] = []) {
  const log: Batch[] = [...initial];
  let clock = log.reduce((m, b) => Math.max(m, b.clock), 0);
  const recorder = branchMetaRecorder((event) => {
    clock += 1;
    log.push(graphEventToBatch(event, { clock, actor: ACTOR }));
  });
  return { log, recorder };
}

describe('planBranchMetaMigration (step2 Phase 3 T7-6)', () => {
  it('SQLite にだけある branch を、作成 → コミット → status の順で載せ直す', () => {
    const branch = legacyBranch(1, BRANCH_STATUS.MERGED);
    const steps = planBranchMetaMigration({
      trunkBatches: [],
      legacyBranches: [branch],
      legacyCommits: new Map([[branch.branchFileId, [commit(1, 5)]]]),
      trunkFileId: TRUNK,
    });
    expect(steps.map((s) => s.kind)).toEqual([
      'branchCreated',
      'commitAdded',
      'statusChanged',
    ]);
  });

  it('🔴 載せ直した後の畳み込みが SQLite の内容を再現する', () => {
    // 読み口 (T7-1) から見て、載せ直す前と同じ branch / commit / status が出ること
    const branch = legacyBranch(1, BRANCH_STATUS.MERGED);
    const branchCommit = commit(1, 5);
    const mergeCommit = commit(2, 9, {
      kind: COMMIT_KIND.MERGE,
      sourceBranchId: branch.id,
      sourceAt: 5,
    });
    const { log, recorder } = recordingLog();
    applyBranchMetaMigration(
      planBranchMetaMigration({
        trunkBatches: [],
        legacyBranches: [branch],
        legacyCommits: new Map([
          [branch.branchFileId, [branchCommit]],
          [TRUNK, [mergeCommit]],
        ]),
        trunkFileId: TRUNK,
      }),
      recorder,
    );

    const fold = foldBranches(log, TRUNK);
    expect(fold.branches.get(branch.id)).toEqual(branch);
    expect(fold.branchCommits.get(branch.id)).toEqual([branchCommit]);
    expect(fold.trunkCommits).toEqual([mergeCommit]);
  });

  it('op-log に既にある branch は、status も含めて触らない (T7-1 以降の記録が正)', () => {
    const branch = legacyBranch(1);
    const { log, recorder } = recordingLog();
    recorder.branchCreated(branch);
    recorder.statusChanged(branch.id, BRANCH_STATUS.CLOSED);
    // SQLite の行は T7-1 以前の古い status (open) のまま
    expect(
      planBranchMetaMigration({
        trunkBatches: log,
        legacyBranches: [branch],
        legacyCommits: new Map(),
        trunkFileId: TRUNK,
      }),
    ).toEqual([]);
  });

  it('🔴 T7-1 以降に削除した branch は作り直しても見えないまま (判定は生の op)', () => {
    // 削除は `branch.remove` だけを書き、SQLite の行は残っている。畳み込みの結果で判定すると
    // 「無い」に見えるが、remove-wins なので載せ直しても一覧には戻らない
    const branch = legacyBranch(1);
    const { log, recorder } = recordingLog();
    recorder.removed(branch.id);
    applyBranchMetaMigration(
      planBranchMetaMigration({
        trunkBatches: [...log],
        legacyBranches: [branch],
        legacyCommits: new Map(),
        trunkFileId: TRUNK,
      }),
      recorder,
    );
    expect(foldBranches(log, TRUNK).branches.has(branch.id)).toBe(false);
  });

  it('既に記録されたコミットは載せ直さない', () => {
    const branch = legacyBranch(1);
    const recordedCommit = commit(1, 5);
    const { log, recorder } = recordingLog();
    recorder.commitAdded(recordedCommit);
    const steps = planBranchMetaMigration({
      trunkBatches: log,
      legacyBranches: [branch],
      legacyCommits: new Map([
        [branch.branchFileId, [recordedCommit, commit(2, 6)]],
      ]),
      trunkFileId: TRUNK,
    });
    expect(
      steps.flatMap((s) =>
        s.kind === 'commitAdded' ? [s.commit.id as string] : [],
      ),
    ).toEqual([id(2)]);
  });

  it('既存の fork は普通の branch として移る (SQLite は理由と同一性を持たない)', () => {
    // T6 の fork の行は branch の列しか持たないので、そのまま普通の branch になる (決定 6)
    const branch = { ...legacyBranch(1), name: '競合: 要件A の内容' };
    const { log, recorder } = recordingLog();
    applyBranchMetaMigration(
      planBranchMetaMigration({
        trunkBatches: [],
        legacyBranches: [branch],
        legacyCommits: new Map(),
        trunkFileId: TRUNK,
      }),
      recorder,
    );
    const moved = foldBranches(log, TRUNK).branches.get(branch.id);
    expect(moved?.name).toBe('競合: 要件A の内容');
    expect(moved && 'origin' in moved).toBe(false);
  });

  it('性質: 載せ直した後にもう一度計画すると空である (べき等)', () => {
    // 生成器: 小さなプールの branch に status と「既に op-log にあるか」「削除済みか」を引く。
    // 削除済み (create 無し) を混ぜないと、生の op で判定する理由の境界に当たらない
    const statusArb = fc.constantFrom(
      BRANCH_STATUS.OPEN,
      BRANCH_STATUS.MERGED,
      BRANCH_STATUS.CLOSED,
    );
    const branchArb = fc.record({
      status: statusArb,
      onOplog: fc.boolean(),
      removed: fc.boolean(),
      commits: fc.integer({ min: 0, max: 2 }),
    });
    fc.assert(
      fc.property(
        fc.array(branchArb, { minLength: 0, maxLength: 4 }),
        fc.integer({ min: 0, max: 2 }),
        (specs, trunkCommits) => {
          const { log, recorder } = recordingLog();
          const branches = specs.map((s, i) => legacyBranch(i, s.status));
          const legacyCommits = new Map<FileId, Commit[]>([
            [
              TRUNK,
              Array.from({ length: trunkCommits }, (_, k) =>
                commit(900 + k, 10 + k, { kind: COMMIT_KIND.MERGE }),
              ),
            ],
          ]);
          specs.forEach((s, i) => {
            const b = branches[i] as BranchMeta;
            if (s.onOplog) recorder.branchCreated(b);
            if (s.removed) recorder.removed(b.id);
            legacyCommits.set(
              b.branchFileId,
              Array.from({ length: s.commits }, (_, k) =>
                commit(500 + i * 10 + k, 3 + k),
              ),
            );
          });
          const input = {
            legacyBranches: branches,
            legacyCommits,
            trunkFileId: TRUNK,
          };
          applyBranchMetaMigration(
            planBranchMetaMigration({ ...input, trunkBatches: [...log] }),
            recorder,
          );
          expect(
            planBranchMetaMigration({ ...input, trunkBatches: [...log] }),
          ).toEqual([]);
        },
      ),
    );
  });
});

describe('migrateBranchMeta', () => {
  it('trunk と branch 専用 file_id の SQLite の行を読んで載せ直し、件数を返す', async () => {
    const branch = legacyBranch(1);
    const { log, recorder } = recordingLog();
    const result = await migrateBranchMeta(TRUNK, {
      fetchBatches: async () => [],
      fetchLegacyBranches: async () => [branch],
      fetchLegacyCommits: async (fileId) =>
        fileId === branch.branchFileId ? [commit(1, 5)] : [],
      recorder,
    });
    expect(result.branches.map((b) => b.id)).toEqual([branch.id]);
    expect(result.commits).toBe(1);
    expect(foldBranches(log, TRUNK).branches.get(branch.id)).toEqual(branch);
  });

  it('読み出しが失敗したら何も書かずに投げる', async () => {
    const { log, recorder } = recordingLog();
    await expect(
      migrateBranchMeta(TRUNK, {
        fetchBatches: async () => [],
        fetchLegacyBranches: async () => [legacyBranch(1)],
        fetchLegacyCommits: async () => {
          throw new Error('daemon down');
        },
        recorder,
      }),
    ).rejects.toThrow('daemon down');
    expect(log).toEqual([]);
  });
});
