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
    expect(filterBatchesForRemote([])).toEqual([]);
  });

  it('全 op が syncable な content batch は同一参照で通す (複製しない)', () => {
    const b = batch({ ops: [addNode('n1'), addNode('n2')], sheetId: SHEET });
    const out = filterBatchesForRemote([b]);
    expect(out).toHaveLength(1);
    // ops が減らないので複製せず元の参照を返す
    expect(out[0]).toBe(b);
  });

  it('mixed batch は presentation を除いた複製を返し、他フィールドを保存する', () => {
    const b = batch({
      id: 'batch-9' as Batch['id'],
      actor: 'did:plc:bob',
      clock: 7,
      timestamp: 1_700_000_009_000,
      sheetId: SHEET,
      ops: [addNode('n1'), setStyle('n1'), addNode('n2')],
    });
    const out = filterBatchesForRemote([b]);
    expect(out).toHaveLength(1);
    expect(out[0]).not.toBe(b); // 複製
    expect(out[0].ops).toEqual([addNode('n1'), addNode('n2')]);
    // id/clock/timestamp/actor/sheetId は保存
    expect(out[0].id).toBe('batch-9' as Batch['id']);
    expect(out[0].actor).toBe('did:plc:bob');
    expect(out[0].clock).toBe(7);
    expect(out[0].timestamp).toBe(1_700_000_009_000);
    expect(out[0].sheetId).toBe(SHEET);
  });

  it('全 op が presentation の batch は remote へ送らない (skip)', () => {
    const b = batch({ ops: [setStyle('n1'), setLabelOffset('e1')] });
    expect(filterBatchesForRemote([b])).toEqual([]);
  });

  it('genesis actor の batch も remote へ通す (Phase 4e-0・C1 見直し)', () => {
    const b = batch({ actor: GENESIS_ACTOR, ops: [addNode('n1')] });
    const out = filterBatchesForRemote([b]);
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
    const out = filterBatchesForRemote([mixed, presOnly]);
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
    const out = filterBatchesForRemote([genesis, content, presOnly, mixed]);
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
    filterBatchesForRemote([b]);
    expect(b.ops).toHaveLength(2); // 元 batch の ops は不変
  });
});
