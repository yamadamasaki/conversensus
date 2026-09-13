import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  type BranchId,
  BranchIdSchema,
  CommitIdSchema,
  type FileId,
  FileIdSchema,
  NodeIdSchema,
  SheetIdSchema,
} from '../schemas';
import { foldBranches } from './branchFold';
import type { Commit } from './branchLog';
import { isFork } from './fork';
import {
  type Batch,
  BatchIdSchema,
  BRANCH_STATUS,
  COMMIT_KIND,
  type Op,
} from './unified';

const TRUNK: FileId = FileIdSchema.parse(crypto.randomUUID());
const SHEET = SheetIdSchema.parse(crypto.randomUUID());
const bid = (): BranchId => BranchIdSchema.parse(crypto.randomUUID());
const commit = (at = 1): Commit => ({
  id: CommitIdSchema.parse(crypto.randomUUID()),
  message: 'base',
  at,
  authorActor: 'a',
  kind: COMMIT_KIND.COMMIT,
});
let seq = 0;
const batch = (clock: number, ops: Op[], actor = 'a'): Batch => ({
  id: BatchIdSchema.parse(crypto.randomUUID()),
  actor,
  clock,
  timestamp: seq++,
  ops,
});
const create = (
  id: BranchId,
  extra: Partial<Extract<Op, { kind: 'branch.create' }>> = {},
): Op => ({
  kind: 'branch.create',
  target: id,
  name: 'b',
  sheetId: SHEET,
  branchFileId: FileIdSchema.parse(crypto.randomUUID()),
  base: commit(),
  ...extra,
});
const NODE = NodeIdSchema.parse(crypto.randomUUID());
const side = (op: unknown) => ({
  batchId: BatchIdSchema.parse(crypto.randomUUID()),
  actor: 'a',
  clock: 1,
  op,
});
const origin = (
  op: unknown = { kind: 'node.setContent', target: NODE, content: 'x' },
) => ({
  category: 'content' as const,
  target: NODE,
  targetLabel: '主張',
  ours: side(op),
  theirs: side(op),
  baseAt: 1,
});

describe('foldBranches — branch', () => {
  test('branch.create で branch が現れ、作成直後は open', () => {
    const id = bid();
    const { branches } = foldBranches([batch(1, [create(id)])], TRUNK);
    expect(branches.get(id)).toMatchObject({
      id,
      status: BRANCH_STATUS.OPEN,
      trunkFileId: TRUNK,
    });
  });

  test('同じ id の branch.create は最初の 1 回だけが効く', () => {
    const id = bid();
    const { branches } = foldBranches(
      [
        batch(1, [create(id, { name: '先' })]),
        batch(2, [create(id, { name: '後' })]),
      ],
      TRUNK,
    );
    expect(branches.get(id)?.name).toBe('先');
  });

  test('status は LWW — clock の大きい方が残る (投入順に依存しない)', () => {
    const id = bid();
    const later = batch(3, [
      { kind: 'branch.setStatus', target: id, status: BRANCH_STATUS.CLOSED },
    ]);
    const earlier = batch(2, [
      { kind: 'branch.setStatus', target: id, status: BRANCH_STATUS.MERGED },
    ]);
    const { branches } = foldBranches(
      [later, batch(1, [create(id)]), earlier],
      TRUNK,
    );
    expect(branches.get(id)?.status).toBe(BRANCH_STATUS.CLOSED);
  });

  test('居ない branch への setStatus は無視する', () => {
    const { branches } = foldBranches(
      [
        batch(1, [
          {
            kind: 'branch.setStatus',
            target: bid(),
            status: BRANCH_STATUS.MERGED,
          },
        ]),
      ],
      TRUNK,
    );
    expect(branches.size).toBe(0);
  });
});

describe('foldBranches — fork', () => {
  test('conflictKey と正しい origin を持てば fork になる', () => {
    const id = bid();
    const { branches } = foldBranches(
      [batch(1, [create(id, { conflictKey: 'k', origin: origin() })])],
      TRUNK,
    );
    const b = branches.get(id);
    expect(b && isFork(b)).toBe(true);
  });

  test('同じ conflictKey の fork は 1 つに畳む — 参加者が独立に書いても', () => {
    const a = bid();
    const b = bid();
    const { branches } = foldBranches(
      [
        batch(1, [create(a, { conflictKey: 'k', origin: origin() })], 'alice'),
        batch(1, [create(b, { conflictKey: 'k', origin: origin() })], 'bob'),
      ],
      TRUNK,
    );
    expect([...branches.values()].filter(isFork)).toHaveLength(1);
  });

  test('別名に対する setStatus も、正の fork に効く', () => {
    const a = bid();
    const b = bid();
    const { branches } = foldBranches(
      [
        batch(1, [create(a, { conflictKey: 'k', origin: origin() })], 'alice'),
        batch(2, [create(b, { conflictKey: 'k', origin: origin() })], 'bob'),
        batch(
          3,
          [
            {
              kind: 'branch.setStatus',
              target: b,
              status: BRANCH_STATUS.CLOSED,
            },
          ],
          'bob',
        ),
      ],
      TRUNK,
    );
    expect(branches.get(a)?.status).toBe(BRANCH_STATUS.CLOSED);
    expect(branches.has(b)).toBe(false);
  });

  test('origin の中の op が OpSchema に合わなければ、記述だけ落として普通の branch にする', () => {
    // 他の参加者が書いたログを信用しない。同一性 (conflictKey) では畳むが、
    // 理由の無い fork を理由付きのように見せない
    const a = bid();
    const b = bid();
    const { branches } = foldBranches(
      [
        batch(
          1,
          [
            create(a, {
              conflictKey: 'k',
              origin: origin({ kind: '壊れた op' }),
            }),
          ],
          'alice',
        ),
        batch(2, [create(b, { conflictKey: 'k', origin: origin() })], 'bob'),
      ],
      TRUNK,
    );
    expect(branches.size).toBe(1);
    const only = branches.get(a);
    expect(only && isFork(only)).toBe(false);
  });
});

describe('foldBranches — 同じ batch が再び届く', () => {
  test('同じ batch を 2 回渡しても、中の setStatus が後から効いたりしない', () => {
    // 性質テストが見つけた反例。batch の中で setStatus が create より前にあると、
    // 1 回目は「居ない branch」として無視される。重複をそのまま畳むと 2 回目には
    // 効いてしまい、再受信だけで結果が変わる
    const id = bid();
    const b = batch(1, [
      { kind: 'branch.setStatus', target: id, status: BRANCH_STATUS.CLOSED },
      create(id),
    ]);
    expect(foldBranches([b, b], TRUNK)).toEqual(foldBranches([b], TRUNK));
    expect(foldBranches([b, b], TRUNK).branches.get(id)?.status).toBe(
      BRANCH_STATUS.OPEN,
    );
  });
});

describe('foldBranches — commit', () => {
  test('branchId が無ければ trunk、あれば branch のコミット', () => {
    const id = bid();
    const t = commit(5);
    const c = commit(6);
    const { trunkCommits, branchCommits } = foldBranches(
      [
        batch(1, [create(id)]),
        batch(5, [{ kind: 'commit.add', commit: t }]),
        batch(6, [{ kind: 'commit.add', branchId: id, commit: c }]),
      ],
      TRUNK,
    );
    expect(trunkCommits).toEqual([t]);
    expect(branchCommits.get(id)).toEqual([c]);
  });

  test('同じ commit が 2 回届いても 1 回に数える', () => {
    const t = commit(5);
    const { trunkCommits } = foldBranches(
      [
        batch(5, [{ kind: 'commit.add', commit: t }]),
        batch(6, [{ kind: 'commit.add', commit: t }]),
      ],
      TRUNK,
    );
    expect(trunkCommits).toHaveLength(1);
  });
});

// --- 性質 ---

/**
 * 生成器は**小さなプールから引く**。id / conflictKey / clock / actor を広く引くと
 * 衝突が起きず、「同じ id の create」「同じ conflictKey の fork」「同じ clock での
 * 並び」という、この畳み込みが決めている境界を一度も通らない。
 */
const IDS = [bid(), bid()];
const FILE_IDS = [
  FileIdSchema.parse(crypto.randomUUID()),
  FileIdSchema.parse(crypto.randomUUID()),
];
const BASE = commit(1);
const COMMITS = [commit(2), commit(3)];
const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc
    .record({
      kind: fc.constant('branch.create' as const),
      target: fc.constantFrom(...IDS),
      name: fc.constantFrom('x', 'y'),
      sheetId: fc.constant(SHEET),
      branchFileId: fc.constantFrom(...FILE_IDS),
      base: fc.constant(BASE),
      conflictKey: fc.constantFrom('k1', 'k2', undefined),
    })
    .map(({ conflictKey, ...rest }) =>
      conflictKey === undefined
        ? rest
        : { ...rest, conflictKey, origin: origin() },
    ),
  fc.record({
    kind: fc.constant('branch.setStatus' as const),
    target: fc.constantFrom(...IDS),
    status: fc.constantFrom(
      BRANCH_STATUS.OPEN,
      BRANCH_STATUS.MERGED,
      BRANCH_STATUS.CLOSED,
    ),
  }),
  fc
    .record({
      kind: fc.constant('commit.add' as const),
      branchId: fc.constantFrom(...IDS, undefined),
      commit: fc.constantFrom(...COMMITS),
    })
    .map(({ branchId, ...rest }) =>
      branchId === undefined ? rest : { ...rest, branchId },
    ),
);
const batchArb: fc.Arbitrary<Batch> = fc
  .record({
    id: fc.constantFrom(
      ...Array.from({ length: 6 }, () =>
        BatchIdSchema.parse(crypto.randomUUID()),
      ),
    ),
    actor: fc.constantFrom('alice', 'bob'),
    clock: fc.integer({ min: 1, max: 4 }),
    ops: fc.array(opArb, { minLength: 1, maxLength: 2 }),
  })
  .map((b) => ({ ...b, timestamp: 0 }));
/**
 * **log の中で batch の id は一意にする。**同じ id で中身の違う batch は実在しない
 * (保存が `UNIQUE(file_id, batch_id)`)。それを許すと (clock, actor, id) が完全に同点に
 * なり、入力の並びが結果に出るのは畳み込みの不具合ではなく入力の不正である
 */
const logArb = fc.uniqueArray(batchArb, {
  selector: (b) => b.id,
  maxLength: 6,
});

describe('性質: 畳み込みは入力の並びと重複に依存しない', () => {
  test('並びを入れ替えても結果は変わらない', () => {
    fc.assert(
      fc.property(logArb, (log) => {
        expect(foldBranches([...log].reverse(), TRUNK)).toEqual(
          foldBranches(log, TRUNK),
        );
      }),
    );
  });

  test('同じ batch が 2 回届いても結果は変わらない (冪等)', () => {
    fc.assert(
      fc.property(logArb, (log) => {
        expect(foldBranches([...log, ...log], TRUNK)).toEqual(
          foldBranches(log, TRUNK),
        );
      }),
    );
  });

  test('同じ conflictKey の fork は常に高々 1 つ', () => {
    fc.assert(
      fc.property(logArb, (log) => {
        const keys = [...foldBranches(log, TRUNK).branches.values()]
          .filter(isFork)
          .map((f) => f.conflictKey);
        expect(new Set(keys).size).toBe(keys.length);
      }),
    );
  });
});
