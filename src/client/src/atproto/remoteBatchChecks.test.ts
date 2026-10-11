import { describe, expect, it } from 'bun:test';
import {
  type Batch,
  type BatchId,
  type FileId,
  GENESIS_ACTOR,
  type NodeId,
  type SheetId,
} from '@conversensus/shared';
import { batchToRecord } from './batchMapper';
import { batchRkey } from './batchRkey';
import {
  checkClockUnique,
  checkGenesisPresent,
  classifyRecords,
  type ListedRecord,
} from './remoteBatchChecks';
import { NSID } from './types';

const FILE = '22222222-2222-4222-8222-222222222222' as FileId;
const OTHER_FILE = '33333333-3333-4333-8333-333333333333' as FileId;
const SHEET = '11111111-1111-4111-8111-111111111111' as SheetId;
const ALICE = 'did:plc:alice#dev1';
const REPO = 'did:plc:alice';

let n = 0;
const nextId = () =>
  `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` as BatchId;

const batchOf = (over: Partial<Batch> = {}): Batch => ({
  id: nextId(),
  actor: ALICE,
  clock: 1,
  seq: 1,
  deps: {},
  timestamp: 1_700_000_000_000,
  sheetId: SHEET,
  ops: [
    {
      kind: 'node.add',
      target: '44444444-4444-4444-8444-444444444444' as NodeId,
      content: 'ノード',
    },
  ],
  ...over,
});

/** listRecords が返す形のレコード。rkey は本番と同じ組み立て方で作る */
const recordOf = (
  batch: Batch,
  fileId: FileId = FILE,
  rkey = batchRkey(fileId, batch.actor, batch.seq),
): ListedRecord => ({
  uri: `at://${REPO}/${NSID.batch}/${rkey}`,
  cid: 'cid',
  value: { $type: NSID.batch, ...batchToRecord(batch, fileId) },
});

describe('classifyRecords (#254: op-log v2 の rkey)', () => {
  it('v2 の rkey と本文が揃ったレコードを batch に戻し、clock 順に並べる', () => {
    const later = batchOf({ clock: 5, seq: 2 });
    const earlier = batchOf({ clock: 2, seq: 1 });
    const { remoteBatches, foreign, invalid } = classifyRecords([
      recordOf(later),
      recordOf(earlier),
    ]);
    expect(remoteBatches.map((rb) => rb.batch.id)).toEqual([
      earlier.id,
      later.id,
    ]);
    expect(remoteBatches[0]?.fileId).toBe(FILE);
    expect(foreign).toEqual([]);
    expect(invalid).toEqual([]);
  });

  it('v1 の rkey (`v1~…`) は別物として数え、検査に入れない', () => {
    const v1 = `v1~${FILE}~000000000001~${nextId()}`;
    const { remoteBatches, foreign } = classifyRecords([
      recordOf(batchOf(), FILE, v1),
    ]);
    expect(remoteBatches).toEqual([]);
    expect(foreign).toEqual([v1]);
  });

  it('本文の fileId が rkey と違えば読まない (受信経路と同じ扱い)', () => {
    const batch = batchOf();
    const record = recordOf(batch, OTHER_FILE, batchRkey(FILE, ALICE, 1));
    const { remoteBatches, invalid } = classifyRecords([record]);
    expect(remoteBatches).toEqual([]);
    expect(invalid.map((i) => i.reason)).toEqual([
      '本文の (fileId, actor, seq) が rkey と違う',
    ]);
  });

  it('本文の seq が rkey と違えば読まない', () => {
    const record = recordOf(
      batchOf({ seq: 2 }),
      FILE,
      batchRkey(FILE, ALICE, 7),
    );
    expect(classifyRecords([record]).invalid).toHaveLength(1);
  });

  it('batch の形をしていない本文は読まない', () => {
    const record: ListedRecord = {
      uri: `at://${REPO}/${NSID.batch}/${batchRkey(FILE, ALICE, 1)}`,
      cid: 'cid',
      value: { id: 'x' },
    };
    expect(classifyRecords([record]).invalid.map((i) => i.reason)).toEqual([
      'batch レコードの形をしていない',
    ]);
  });
});

describe('checkGenesisPresent', () => {
  it('genesis が 1 件も無ければ FAIL', () => {
    const { remoteBatches } = classifyRecords([recordOf(batchOf())]);
    expect(checkGenesisPresent(remoteBatches).ok).toBe(false);
  });

  it('genesis があれば PASS。genesis の無い File (参加した File) は数を添えるだけ', () => {
    const genesis = batchOf({
      actor: GENESIS_ACTOR,
      sheetId: undefined,
      ops: [{ kind: 'file.setName', name: 'F' }],
    });
    const { remoteBatches } = classifyRecords([
      recordOf(genesis),
      recordOf(batchOf(), OTHER_FILE),
    ]);
    const check = checkGenesisPresent(remoteBatches);
    expect(check.ok).toBe(true);
    expect(check.detail).toContain('genesis の無い File 1 件');
  });
});

describe('checkClockUnique', () => {
  it('同じ file × sheet × actor で clock が重なれば FAIL', () => {
    const { remoteBatches } = classifyRecords([
      recordOf(batchOf({ clock: 4, seq: 1 })),
      recordOf(batchOf({ clock: 4, seq: 2 })),
    ]);
    expect(checkClockUnique(remoteBatches).ok).toBe(false);
  });

  it('別の actor の clock の重なりは並行編集の証跡なので PASS', () => {
    const { remoteBatches } = classifyRecords([
      recordOf(batchOf({ clock: 4, seq: 1 })),
      recordOf(batchOf({ clock: 4, seq: 1, actor: 'did:plc:bob#dev2' })),
    ]);
    expect(checkClockUnique(remoteBatches).ok).toBe(true);
  });
});
