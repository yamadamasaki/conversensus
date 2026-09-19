import { describe, expect, test } from 'bun:test';
import {
  BranchIdSchema,
  type BranchMeta,
  type Commit,
  CommitIdSchema,
  type Dtr,
  DtrIdSchema,
  type FileId,
  FileIdSchema,
  SheetIdSchema,
} from '@conversensus/shared';
import { canStartRemerge, type RemergeDtrDeps, remergeDtr } from './remergeDtr';

const TRUNK: FileId = FileIdSchema.parse(crypto.randomUUID());
const RESOLVE_FILE: FileId = FileIdSchema.parse(crypto.randomUUID());
const RESOLVE = BranchIdSchema.parse(crypto.randomUUID());
const CAUSE = BranchIdSchema.parse(crypto.randomUUID());
const DTR = DtrIdSchema.parse(crypto.randomUUID());
const SHEET = SheetIdSchema.parse(crypto.randomUUID());
const ACTOR = 'did:plc:a#dev1';

/** 承認が `satisfiedAt` で揃った DtR */
const dtr = (satisfiedAt?: number): Dtr =>
  ({
    id: DTR,
    branchId: CAUSE,
    resolveBranchId: RESOLVE,
    sheetId: SHEET,
    callees: new Set(['did:plc:a']),
    approvals: new Set(['did:plc:a']),
    openedAt: 1,
    ...(satisfiedAt !== undefined && { satisfiedAt }),
    // biome-ignore lint/suspicious/noExplicitAny: テストの最小 Dtr
  }) as any;

const resolveBranch: BranchMeta = {
  id: RESOLVE,
  name: 'DtR 解決: b',
  base: {
    // **CommitId であること。**branded 型を取り違えて押し込むと、偽物が本物の形から
    // 外れて境界の欠落を隠す (T7-7 で踏んだ形)
    id: CommitIdSchema.parse(crypto.randomUUID()),
    message: '分岐点',
    at: 1,
    authorActor: ACTOR,
    kind: 'commit',
  },
  status: 'open',
  sheetId: SHEET,
  trunkFileId: TRUNK,
  branchFileId: RESOLVE_FILE,
};

/** 解決 branch の op-log。先端が関門の材料になる */
const branchLog = (tip: number) =>
  tip === 0
    ? []
    : [
        {
          id: 'b1',
          actor: ACTOR,
          clock: tip,
          timestamp: tip,
          sheetId: SHEET,
          ops: [{ kind: 'node.add', target: SHEET, content: 'x' }],
          // biome-ignore lint/suspicious/noExplicitAny: テストの最小 Batch
        } as any,
      ];

/**
 * @param tip 解決 branch の op-log の先端
 * @returns `commits` は記録された merge コミット。**刻印を見るための受け皿**である
 */
function fakeDeps(tip: number): {
  deps: RemergeDtrDeps;
  commits: Commit[];
  appended: () => number;
} {
  const commits: Commit[] = [];
  let appends = 0;
  return {
    commits,
    appended: () => appends,
    deps: {
      readBranches: async () => new Map([[RESOLVE as string, resolveBranch]]),
      fetchBatches: async (fileId: FileId) =>
        fileId === RESOLVE_FILE ? branchLog(tip) : [],
      appendBatches: async () => {
        appends += 1;
        return 1;
      },
      recordStatus: () => {},
      // **捨てない。**ここに来るコミットが刻印の検証そのものである
      recordCommit: (commit: Commit) => {
        commits.push(commit);
      },
      newId: () => crypto.randomUUID(),
      seedClock: () => {},
      tick: () => 99,
      // biome-ignore lint/suspicious/noExplicitAny: 偽物の deps は最小で足りる
    } as any,
  };
}

describe('canStartRemerge', () => {
  test('承認が揃っていなければ通さない (保留)', () => {
    expect(canStartRemerge(dtr(), 0)).toEqual({
      ok: false,
      reason: 'notApproved',
    });
  });

  test('承認が揃い、その後の変更が無ければ通す', () => {
    expect(canStartRemerge(dtr(5), 4)).toEqual({ ok: true });
  });

  // 承認した人が見たものと、取り込む内容が違う
  test('🔴 承認の後に解決グラフが動いていたら通さない', () => {
    expect(canStartRemerge(dtr(5), 6)).toEqual({
      ok: false,
      reason: 'changedAfterApproval',
    });
  });

  /**
   * **`canRemergeAt` とは同着の扱いが逆である。**あちらは「承認がこの操作より前か」を
   * 問うので同着を通さない。こちらは「承認の後に動いたか」を問うので、同着は
   * 「動いていない」である。同じ clock の比較でも向きが違う。
   */
  test('🔴 先端が承認の位置と同じなら通す (同着は「その後の変更」ではない)', () => {
    expect(canStartRemerge(dtr(5), 5)).toEqual({ ok: true });
  });
});

describe('remergeDtr', () => {
  /**
   * **刻印がこのモジュールの要である。**merge コミットに `dtrId` が載り、写しが
   * `mergedIn` でそれを指すから、承認を経ていない再 merge を projection の手前で
   * 落とせる (`admissibleBatches`)。ここが抜けると鎖が切れる。
   */
  test('🔴 関門を通ったら merge へ委譲し、merge コミットに dtrId を刻む', async () => {
    const { deps, commits, appended } = fakeDeps(5);
    const result = await remergeDtr(
      dtr(5),
      { message: '解決を取り込む', actor: ACTOR, trunkFileId: TRUNK },
      deps,
    );

    expect(result.ok).toBe(true);
    expect(appended()).toBe(1);
    expect(commits).toHaveLength(1);
    expect(commits[0]?.dtrId).toBe(DTR);
    // 通常の merge と同じ記録であることも併せて見る (新しい機構を作っていない)
    expect(commits[0]?.kind).toBe('merge');
    expect(commits[0]?.sourceBranchId).toBe(RESOLVE);
    expect(commits[0]?.message).toBe('解決を取り込む');
  });

  test('🔴 関門で止めたときは何も書かない', async () => {
    const { deps, commits, appended } = fakeDeps(9);
    const result = await remergeDtr(
      dtr(5),
      { message: '取り込む', actor: ACTOR, trunkFileId: TRUNK },
      deps,
    );

    expect(result).toEqual({ ok: false, reason: 'changedAfterApproval' });
    expect(appended()).toBe(0);
    expect(commits).toEqual([]);
  });

  test('承認が揃っていなければ何も書かない (保留)', async () => {
    const { deps, commits } = fakeDeps(0);
    const result = await remergeDtr(
      dtr(),
      { message: '取り込む', actor: ACTOR, trunkFileId: TRUNK },
      deps,
    );

    expect(result).toEqual({ ok: false, reason: 'notApproved' });
    expect(commits).toEqual([]);
  });

  test('解決 branch が記録から引けなければ理由を返す', async () => {
    const { deps, commits } = fakeDeps(5);
    const result = await remergeDtr(
      dtr(5),
      { message: '取り込む', actor: ACTOR, trunkFileId: TRUNK },
      { ...deps, readBranches: async () => new Map() },
    );

    expect(result).toEqual({ ok: false, reason: 'resolveBranchMissing' });
    expect(commits).toEqual([]);
  });
});
