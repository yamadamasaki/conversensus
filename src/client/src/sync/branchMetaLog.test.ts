import { describe, expect, test } from 'bun:test';
import {
  type Batch,
  BatchIdSchema,
  BRANCH_STATUS,
  BranchIdSchema,
  type BranchMeta,
  COMMIT_KIND,
  CommitIdSchema,
  FileIdSchema,
  type ForkMeta,
  isFork,
  NodeIdSchema,
  SheetIdSchema,
} from '@conversensus/shared';
import type { GraphEvent } from '../events/GraphEvent';
import { graphEventToBatch } from '../events/toUnified';
import { branchMetaRecorder, readBranchMeta } from './branchMetaLog';

const TRUNK = FileIdSchema.parse(crypto.randomUUID());
const uuid = () => crypto.randomUUID();

/** trunk の tap の代わり。record した event を batch にして trunk の op-log へ積む */
function setup() {
  const log: Batch[] = [];
  let clock = 0;
  const record = (event: GraphEvent) => {
    clock += 1;
    log.push(graphEventToBatch(event, { clock, actor: 'did:plc:alice#dev' }));
  };
  return {
    log,
    rec: branchMetaRecorder(record),
    read: () =>
      readBranchMeta(async (id) => (id === TRUNK ? [...log] : []), TRUNK),
  };
}

const meta = (): BranchMeta => ({
  id: BranchIdSchema.parse(uuid()),
  name: 'feature',
  base: {
    id: CommitIdSchema.parse(uuid()),
    message: '分岐点',
    at: 1,
    authorActor: 'did:plc:alice#dev',
    kind: COMMIT_KIND.COMMIT,
  },
  status: BRANCH_STATUS.OPEN,
  sheetId: SheetIdSchema.parse(uuid()),
  trunkFileId: TRUNK,
  branchFileId: FileIdSchema.parse(uuid()),
});

describe('branchMetaLog', () => {
  test('記録した branch を trunk から読める', async () => {
    const { rec, read } = setup();
    const m = meta();
    rec.branchCreated(m);
    expect((await read()).branches.get(m.id)).toEqual(m);
  });

  test('状態の変更と削除が読み出しに反映される', async () => {
    const { rec, read } = setup();
    const a = meta();
    const b = meta();
    rec.branchCreated(a);
    rec.branchCreated(b);
    rec.statusChanged(a.id, BRANCH_STATUS.MERGED);
    rec.removed(b.id);
    const { branches } = await read();
    expect(branches.get(a.id)?.status).toBe(BRANCH_STATUS.MERGED);
    expect(branches.has(b.id)).toBe(false);
  });

  test('コミットは branchId の有無で trunk と branch に振り分けられる', async () => {
    const { rec, read } = setup();
    const m = meta();
    rec.branchCreated(m);
    const onTrunk = {
      ...m.base,
      id: CommitIdSchema.parse(uuid()),
      kind: COMMIT_KIND.MERGE,
    };
    const onBranch = { ...m.base, id: CommitIdSchema.parse(uuid()) };
    rec.commitAdded(onTrunk);
    rec.commitAdded(onBranch, m.id);
    const { trunkCommits, branchCommits } = await read();
    expect(trunkCommits).toEqual([onTrunk]);
    expect(branchCommits.get(m.id)).toEqual([onBranch]);
  });

  test('fork の conflictKey と origin が記録から読み戻しまで残る (設計 事実 G の回帰)', async () => {
    // 以前は daemon の SQLite が branch の列しか保存せず、読み戻すと普通の branch になっていた
    const { rec, read } = setup();
    const node = NodeIdSchema.parse(uuid());
    const op = { kind: 'node.setContent' as const, target: node, content: 'x' };
    const side = {
      batchId: BatchIdSchema.parse(uuid()),
      actor: 'did:plc:bob#dev',
      clock: 2,
      op,
    };
    const fork: ForkMeta = {
      ...meta(),
      conflictKey: 'content n  a b',
      origin: {
        category: 'content',
        target: node,
        targetLabel: '主張',
        ours: side,
        theirs: side,
        baseAt: 1,
      },
    };
    rec.branchCreated(fork);
    const read1 = (await read()).branches.get(fork.id);
    expect(read1 && isFork(read1)).toBe(true);
    expect(read1).toEqual(fork);
  });

  test('記録は file 構造の batch である (sheetId を持たない)', async () => {
    // sheetId を付けると content batch として扱われ、そのシートの projection に混ざる
    const { rec, log } = setup();
    rec.branchCreated(meta());
    rec.commitAdded(meta().base);
    expect(log.every((b) => b.sheetId === undefined)).toBe(true);
  });
});
