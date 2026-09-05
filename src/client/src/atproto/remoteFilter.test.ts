import { describe, expect, it } from 'bun:test';
import {
  type Batch,
  type EdgeId,
  GENESIS_ACTOR,
  type NodeId,
  type Op,
  type SheetId,
} from '@conversensus/shared';
import { filterBatchesForRemote } from './remoteFilter';

const SHEET = '11111111-1111-4111-8111-111111111111' as SheetId;

/** この端末がログインしている DID。既定の `batch()` はこの DID の端末が書いたことにする */
const MY_DID = 'did:plc:alice';
/** 他 actor。Phase 2 の受信でローカル正典に入ってくる側 */
const OTHER_DID = 'did:plc:bob';

// content op (syncable)
const addNode = (id: string): Op => ({
  kind: 'node.add',
  target: id as NodeId,
  content: 'ノード',
});
// presentation op (ローカル限定・非 syncable)
const setStyle = (id: string): Op => ({
  kind: 'node.setStyle',
  target: id as NodeId,
  style: {},
});
const setLabelOffset = (id: string): Op => ({
  kind: 'edge.setLabelOffset',
  target: id as EdgeId,
  offsetX: 1,
  offsetY: 2,
});

const batch = (over: Partial<Batch> & Pick<Batch, 'ops'>): Batch => ({
  id: 'batch-1' as Batch['id'],
  actor: 'did:plc:alice',
  clock: 1,
  timestamp: 1_700_000_000_000,
  ...over,
});

describe('filterBatchesForRemote', () => {
  it('空入力は空を返す', () => {
    expect(filterBatchesForRemote([], MY_DID)).toEqual([]);
  });

  it('全 op が syncable な content batch は同一参照で通す (複製しない)', () => {
    const b = batch({ ops: [addNode('n1'), addNode('n2')], sheetId: SHEET });
    const out = filterBatchesForRemote([b], MY_DID);
    expect(out).toHaveLength(1);
    // ops が減らないので複製せず元の参照を返す
    expect(out[0]).toBe(b);
  });

  it('mixed batch は presentation を除いた複製を返し、他フィールドを保存する', () => {
    const b = batch({
      id: 'batch-9' as Batch['id'],
      // `<did>#<deviceId>` 形式。DID 部分が一致すれば別端末の batch でも自分のもの
      actor: `${MY_DID}#device-2`,
      clock: 7,
      timestamp: 1_700_000_009_000,
      sheetId: SHEET,
      ops: [addNode('n1'), setStyle('n1'), addNode('n2')],
    });
    const out = filterBatchesForRemote([b], MY_DID);
    expect(out).toHaveLength(1);
    expect(out[0]).not.toBe(b); // 複製
    expect(out[0].ops).toEqual([addNode('n1'), addNode('n2')]);
    // id/clock/timestamp/actor/sheetId は保存
    expect(out[0].id).toBe('batch-9' as Batch['id']);
    expect(out[0].actor).toBe(`${MY_DID}#device-2`);
    expect(out[0].clock).toBe(7);
    expect(out[0].timestamp).toBe(1_700_000_009_000);
    expect(out[0].sheetId).toBe(SHEET);
  });

  it('全 op が presentation の batch は remote へ送らない (skip)', () => {
    const b = batch({ ops: [setStyle('n1'), setLabelOffset('e1')] });
    expect(filterBatchesForRemote([b], MY_DID)).toEqual([]);
  });

  it('genesis actor の batch も remote へ通す (Phase 4e-0・C1 見直し)', () => {
    const b = batch({ actor: GENESIS_ACTOR, ops: [addNode('n1')] });
    const out = filterBatchesForRemote([b], MY_DID);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(b); // 全 op syncable なので同一参照
  });

  it('genesis batch でも presentation op は除外し、空になれば送らない', () => {
    const mixed = batch({
      actor: GENESIS_ACTOR,
      ops: [addNode('g1'), setStyle('g1')],
    });
    const presOnly = batch({
      id: 'b2' as Batch['id'],
      actor: GENESIS_ACTOR,
      clock: 2,
      ops: [setStyle('g1')],
    });
    const out = filterBatchesForRemote([mixed, presOnly], MY_DID);
    // mixed は presentation を絞った複製が通り、presOnly は skip
    expect(out).toHaveLength(1);
    expect(out[0].ops).toEqual([addNode('g1')]);
    expect(out[0].actor).toBe(GENESIS_ACTOR);
  });

  it('複数 batch: genesis 通過・presentation skip・content 通過を順序保存で行う', () => {
    const genesis = batch({
      id: 'b0' as Batch['id'],
      actor: GENESIS_ACTOR,
      clock: 0,
      ops: [addNode('g1')],
    });
    const content = batch({
      id: 'b1' as Batch['id'],
      clock: 1,
      ops: [addNode('n1')],
    });
    const presOnly = batch({
      id: 'b2' as Batch['id'],
      clock: 2,
      ops: [setStyle('n1')],
    });
    const mixed = batch({
      id: 'b3' as Batch['id'],
      clock: 3,
      ops: [setStyle('n1'), addNode('n2')],
    });
    const out = filterBatchesForRemote(
      [genesis, content, presOnly, mixed],
      MY_DID,
    );
    // presOnly のみ落ち、genesis・content・mixed(絞り済) が順序保存で残る
    expect(out.map((b) => b.id)).toEqual([
      'b0' as Batch['id'],
      'b1' as Batch['id'],
      'b3' as Batch['id'],
    ]);
    expect(out[2].ops).toEqual([addNode('n2')]);
  });

  it('入力 batch を破壊的に変更しない (元 ops はそのまま)', () => {
    const b = batch({ ops: [addNode('n1'), setStyle('n1')] });
    filterBatchesForRemote([b], MY_DID);
    expect(b.ops).toHaveLength(2); // 元 batch の ops は不変
  });

  // --- 他 actor の batch を送り返さない (step2 Phase 2 S0) ---

  describe('著者による除外 (step2 Phase 2 S0)', () => {
    it('他 actor が書いた batch は remote へ送らない', () => {
      const b = batch({ actor: OTHER_DID, ops: [addNode('n1')] });
      expect(filterBatchesForRemote([b], MY_DID)).toEqual([]);
    });

    it('他 actor の別端末 (`<did>#<deviceId>`) も送らない', () => {
      const b = batch({ actor: `${OTHER_DID}#device-9`, ops: [addNode('n1')] });
      expect(filterBatchesForRemote([b], MY_DID)).toEqual([]);
    });

    it('自分の別端末が書いた batch は送る (DID 部分だけを見る)', () => {
      const b = batch({ actor: `${MY_DID}#device-2`, ops: [addNode('n1')] });
      expect(filterBatchesForRemote([b], MY_DID)).toHaveLength(1);
    });

    it('genesis は著者判定の対象外で、誰の repo からでも通る', () => {
      // File の起源であって誰かの判断ではない。content-addressed なので
      // 複数 repo に載っても受信側の batch id dedup が畳む
      const b = batch({ actor: GENESIS_ACTOR, ops: [addNode('g1')] });
      expect(filterBatchesForRemote([b], MY_DID)).toHaveLength(1);
      expect(filterBatchesForRemote([b], OTHER_DID)).toHaveLength(1);
    });

    it('混在した列から自分の分と genesis だけが順序保存で残る', () => {
      const genesis = batch({
        id: 'b0' as Batch['id'],
        actor: GENESIS_ACTOR,
        clock: 0,
        ops: [addNode('g1')],
      });
      const mine = batch({
        id: 'b1' as Batch['id'],
        clock: 1,
        ops: [addNode('n1')],
      });
      const theirs = batch({
        id: 'b2' as Batch['id'],
        actor: OTHER_DID,
        clock: 2,
        ops: [addNode('n2')],
      });
      const mineAgain = batch({
        id: 'b3' as Batch['id'],
        actor: `${MY_DID}#device-2`,
        clock: 3,
        ops: [addNode('n3')],
      });
      const out = filterBatchesForRemote(
        [genesis, mine, theirs, mineAgain],
        MY_DID,
      );
      expect(out.map((b) => b.id)).toEqual([
        'b0' as Batch['id'],
        'b1' as Batch['id'],
        'b3' as Batch['id'],
      ]);
    });
  });
});
