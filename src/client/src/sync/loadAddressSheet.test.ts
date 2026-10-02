import { describe, expect, test } from 'bun:test';
import {
  type Batch,
  BRANCH_STATUS,
  BranchIdSchema,
  type BranchMeta,
  type CommitId,
  FileIdSchema,
  type GraphViewAddress,
  HEAD_CUT,
  makeBaseCommit,
  type NodeId,
  type Op,
  SheetIdSchema,
} from '@conversensus/shared';
import type { GraphEvent } from '../events/GraphEvent';
import { graphEventToBatch } from '../events/toUnified';
import { branchMetaRecorder } from './branchMetaLog';
import { loadAddressSheet } from './loadAddressSheet';

const ACTOR = 'did:plc:alice#dev';
const TRUNK = FileIdSchema.parse(crypto.randomUUID());
const BRANCH_FILE = FileIdSchema.parse(crypto.randomUUID());
const SHEET = SheetIdSchema.parse(crypto.randomUUID());
const BRANCH = BranchIdSchema.parse(crypto.randomUUID());
const NODE_A = crypto.randomUUID() as NodeId;
const NODE_B = crypto.randomUUID() as NodeId;

/** trunk に sheet と node A、branch に node B。branch のメタは trunk の op-log に載る (T7-1) */
function world() {
  let seq = 0;
  const issue = (ops: Op[], sheetId?: typeof SHEET): Batch => {
    seq += 1;
    return {
      id: `b${seq}` as Batch['id'],
      actor: ACTOR,
      clock: seq,
      seq,
      deps: {},
      timestamp: seq,
      ops,
      ...(sheetId && { sheetId }),
    };
  };
  const trunk: Batch[] = [
    issue([{ kind: 'sheet.create', target: SHEET, name: 'S' }]),
    issue([{ kind: 'node.add', target: NODE_A, content: 'a' }], SHEET),
  ];
  const meta: BranchMeta = {
    id: BRANCH,
    name: 'b1',
    base: makeBaseCommit('base' as CommitId, 'base', ACTOR, trunk),
    status: BRANCH_STATUS.OPEN,
    sheetId: SHEET,
    trunkFileId: TRUNK,
    branchFileId: BRANCH_FILE,
  };
  branchMetaRecorder((event: GraphEvent) => {
    seq += 1;
    trunk.push(
      graphEventToBatch(event, { clock: seq, seq, deps: {}, actor: ACTOR }),
    );
  }).branchCreated(meta);
  const branch = [issue([{ kind: 'node.add', target: NODE_B, content: 'b' }])];
  const logs = new Map([
    [TRUNK, trunk],
    [BRANCH_FILE, branch],
  ]);
  return async (fileId: typeof TRUNK) => logs.get(fileId) ?? [];
}

const trunkAddress: GraphViewAddress = {
  fileId: TRUNK,
  sheetId: SHEET,
  branchId: null,
  cut: HEAD_CUT,
};
const nodeIds = (r: Awaited<ReturnType<typeof loadAddressSheet>>) =>
  r.kind === 'sheet' ? r.sheet.nodes.map((n) => n.id).sort() : null;

describe('loadAddressSheet', () => {
  test('trunk のアドレスは trunk の op-log だけから求まる', async () => {
    const result = await loadAddressSheet(trunkAddress, world());
    expect(nodeIds(result)).toEqual([NODE_A]);
    expect(result.fileIds).toEqual([TRUNK]);
  });

  test('branch のアドレスは trunk の畳み込みで branch を解決し、branch 専用の op-log を重ねる', async () => {
    const result = await loadAddressSheet(
      { ...trunkAddress, branchId: BRANCH },
      world(),
    );
    expect(nodeIds(result)).toEqual([NODE_A, NODE_B].sort());
    // 読み直しの契機は trunk と branch 専用の op-log の両方
    expect(result.fileIds).toEqual([TRUNK, BRANCH_FILE]);
  });

  test('無いシート・無い branch は missing', async () => {
    const fetch = world();
    expect(
      (
        await loadAddressSheet(
          {
            ...trunkAddress,
            sheetId: SheetIdSchema.parse(crypto.randomUUID()),
          },
          fetch,
        )
      ).kind,
    ).toBe('missing');
    expect(
      (
        await loadAddressSheet(
          {
            ...trunkAddress,
            branchId: BranchIdSchema.parse(crypto.randomUUID()),
          },
          fetch,
        )
      ).kind,
    ).toBe('missing');
  });
});
