import { describe, expect, it } from 'bun:test';
import {
  type Actor,
  type Batch,
  type FileId,
  type ForkMeta,
  type MergeConflict,
  makeFork,
  type NodeId,
  type SheetId,
} from '@conversensus/shared';
import { graphEventToBatch } from '../events/toUnified';
import { branchMetaRecorder } from './branchMetaLog';
import {
  accumulateArrivedForks,
  detectArrivedForks,
  NO_ARRIVED_FORKS,
} from './forkArrival';

const FILE = '11111111-1111-4111-8111-111111111111' as FileId;
const SHEET = '22222222-2222-4222-8222-222222222222' as SheetId;
const NODE = '33333333-3333-4333-8333-333333333333' as NodeId;
const ALICE = 'did:plc:alice#dev-a' as Actor;
const BOB = 'did:plc:bob#dev-b' as Actor;

let seq = 0;
const uuid = () => {
  seq += 1;
  return `${seq.toString(16).padStart(8, '0')}-4444-4444-8444-444444444444`;
};

/** 同じ競合 (同じ 2 つの batch の content の対立) を表す。誰が検出しても鍵は同じになる */
const conflict = (ours: string, theirs: string): MergeConflict => ({
  target: NODE,
  category: 'content',
  ours: {
    batchId: ours as Batch['id'],
    op: { kind: 'node.setContent', target: NODE, content: 'A' },
  },
  theirs: {
    batchId: theirs as Batch['id'],
    op: { kind: 'node.setContent', target: NODE, content: 'B' },
  },
});

const SIDE_A = uuid();
const SIDE_B = uuid();

/** `author` が検出して作った fork。記述の中身は到着の判定に関係しない */
const forkBy = (author: Actor, c = conflict(SIDE_A, SIDE_B)): ForkMeta =>
  makeFork({
    conflict: c,
    targetLabel: '要件A',
    batchOf: () => undefined,
    localBatches: [],
    sheetId: SHEET,
    trunkFileId: FILE,
    authorActor: author,
    newId: uuid,
  });

/** trunk の op-log に載った形 (T7-1 の記録口と同じ道を通す) */
const recorded = (
  record: (r: ReturnType<typeof branchMetaRecorder>) => void,
  actor: Actor,
  clock: number,
): Batch => {
  const batches: Batch[] = [];
  record(
    branchMetaRecorder((event) =>
      batches.push(graphEventToBatch(event, { clock, actor })),
    ),
  );
  const [batch] = batches;
  if (!batch) throw new Error('記録されていない');
  return batch;
};

const created = (fork: ForkMeta, actor: Actor, clock: number) =>
  recorded((r) => r.branchCreated(fork), actor, clock);

describe('detectArrivedForks (step2 Phase 3 T7-5)', () => {
  it('受信で初めて現れた相手の fork を返す', () => {
    const bobs = forkBy(BOB);
    const arrived = detectArrivedForks({
      trunkFileId: FILE,
      local: [],
      incoming: [created(bobs, BOB, 10)],
      written: [],
    });
    expect(arrived.map((f) => f.conflictKey)).toEqual([bobs.conflictKey]);
  });

  it('同じ競合の fork を手元に持っていれば返さない (両側が同時に検出した)', () => {
    // 別の id でも鍵が同じなら同じ競合である。畳み込みも 1 つに畳む
    const mine = forkBy(ALICE);
    const bobs = forkBy(BOB);
    expect(
      detectArrivedForks({
        trunkFileId: FILE,
        local: [created(mine, ALICE, 5)],
        incoming: [created(bobs, BOB, 10)],
        written: [],
      }),
    ).toEqual([]);
  });

  it('このサイクルで自分が書いた fork は返さない (競合の通知が伝えている)', () => {
    expect(
      detectArrivedForks({
        trunkFileId: FILE,
        local: [],
        incoming: [created(forkBy(BOB), BOB, 10)],
        written: [forkBy(ALICE)],
      }),
    ).toEqual([]);
  });

  it('既に受け取った fork は次のサイクルで返さない', () => {
    const bobsBatch = created(forkBy(BOB), BOB, 10);
    expect(
      detectArrivedForks({
        trunkFileId: FILE,
        local: [bobsBatch],
        incoming: [],
        written: [],
      }),
    ).toEqual([]);
  });

  it('届いた時点で削除されている fork は返さない', () => {
    const bobs = forkBy(BOB);
    expect(
      detectArrivedForks({
        trunkFileId: FILE,
        local: [],
        incoming: [
          created(bobs, BOB, 10),
          recorded((r) => r.removed(bobs.id), BOB, 11),
        ],
        written: [],
      }),
    ).toEqual([]);
  });

  it('別の競合の fork はそれぞれ返す', () => {
    const one = forkBy(BOB);
    const other = forkBy(BOB, conflict(uuid(), uuid()));
    const arrived = detectArrivedForks({
      trunkFileId: FILE,
      local: [created(one, BOB, 10)],
      incoming: [created(other, BOB, 12)],
      written: [],
    });
    expect(arrived.map((f) => f.conflictKey)).toEqual([other.conflictKey]);
  });
});

describe('accumulateArrivedForks', () => {
  it('受信サイクルをまたいで溜める', () => {
    const one = forkBy(BOB);
    const other = forkBy(BOB, conflict(uuid(), uuid()));
    const first = accumulateArrivedForks(NO_ARRIVED_FORKS, [one]);
    expect(accumulateArrivedForks(first, [other])).toEqual([one, other]);
  });

  it('同じ競合は先に届いた方を残す (記述は検出時点で凍結されている)', () => {
    const fromBob = forkBy(BOB);
    const fromCarol = forkBy('did:plc:carol#dev-c' as Actor);
    expect(accumulateArrivedForks([fromBob], [fromCarol])).toEqual([fromBob]);
  });

  it('何も届かなければ溜めてある束をそのまま返す (再描画を起こさない)', () => {
    const prev = [forkBy(BOB)];
    expect(accumulateArrivedForks(prev, [])).toBe(prev);
  });
});
