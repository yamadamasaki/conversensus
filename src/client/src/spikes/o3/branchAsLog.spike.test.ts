/**
 * O3 Spike の実証テスト (投棄前提)
 *
 * Go 判定基準を1本ずつ確認する:
 *   1. ブランチ projection    — base offset + 追記列から状態を導出できる
 *   2. マージ + layout        — content=対立検出 / layout=静かな LWW / structure=OR-Set
 *   3. 複合イベントの分解      — group / paste を基本 op 列に載せられる
 */

import { describe, expect, test } from 'bun:test';
import {
  type Branch,
  type Category,
  type Commit,
  decomposeGroup,
  decomposePaste,
  type Event,
  type EventMeta,
  merge,
  project,
} from './branchAsLog';

// clock を単調増加させる簡易 Lamport 発番器
function makeClock(start = 0) {
  let c = start;
  return (actor: string) =>
    (category: Category): EventMeta => ({
      id: crypto.randomUUID(),
      actor,
      clock: ++c,
      category,
    });
}

describe('O3 spike: branch = operation log divergence', () => {
  test('1. ブランチ projection: base + 追記列から状態を導出できる', () => {
    const tick = makeClock();
    const meta = tick('local');

    // trunk: A, B, A→B
    const base: Event[] = [
      {
        ...meta('structure'),
        op: { kind: 'node.add', target: 'A', content: 'a' },
      },
      {
        ...meta('structure'),
        op: { kind: 'node.add', target: 'B', content: 'b' },
      },
      {
        ...meta('structure'),
        op: { kind: 'edge.add', target: 'E', source: 'A', dest: 'B' },
      },
    ];
    const baseCommit: Commit = { id: 'c0', message: 'base', clock: 3 };

    // branch: A のラベル変更 + C 追加 + A の移動
    const branch: Branch = {
      id: 'br1',
      base: baseCommit,
      ops: [
        {
          ...meta('content'),
          op: { kind: 'node.setContent', target: 'A', content: 'a-branch' },
        },
        {
          ...meta('structure'),
          op: { kind: 'node.add', target: 'C', content: 'c' },
        },
        {
          ...meta('layout'),
          op: { kind: 'layout.set', target: 'A', x: 100, y: 0 },
        },
      ],
    };

    // ブランチの状態 = base + branch.ops を畳み込む
    const state = project([...base, ...branch.ops]);

    expect(state.nodes.get('A')?.content).toBe('a-branch');
    expect(state.nodes.has('C')).toBe(true);
    expect(state.layout.get('A')).toEqual({
      x: 100,
      y: 0,
      w: undefined,
      h: undefined,
    });
    expect([...state.edges.keys()]).toEqual(['E']);
  });

  test('2. マージ: content=対立検出 / layout=静かな LWW / structure=OR-Set', () => {
    const tick = makeClock();

    // base
    const base: Event[] = [
      {
        ...tick('local')('structure'),
        op: { kind: 'node.add', target: 'A', content: 'a' },
      },
    ];

    // trunk が base 以降に A を編集 (content と layout の両方)
    const trunkAfterBase: Event[] = [
      {
        ...tick('alice')('content'),
        op: { kind: 'node.setContent', target: 'A', content: 'a-trunk' },
      },
      {
        ...tick('alice')('layout'),
        op: { kind: 'layout.set', target: 'A', x: 10, y: 10 },
      },
    ];

    // branch も同じ A を別方向に編集 + 新規ノード D 追加
    const branch: Branch = {
      id: 'br',
      base: { id: 'c0', message: 'base', clock: 1 },
      ops: [
        {
          ...tick('bob')('content'),
          op: { kind: 'node.setContent', target: 'A', content: 'a-branch' },
        },
        {
          ...tick('bob')('layout'),
          op: { kind: 'layout.set', target: 'A', x: 99, y: 99 },
        },
        {
          ...tick('bob')('structure'),
          op: { kind: 'node.add', target: 'D', content: 'd' },
        },
      ],
    };

    const { merged, conflicts } = merge(trunkAfterBase, branch);
    const state = project([...base, ...merged]);

    // content: 対立が1件検出される (合意形成の機会として可視化する候補)
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].category).toBe('content');
    expect(conflicts[0].target).toBe('A');

    // content: LWW で暫定確定 (clock が大きい branch 側 'a-branch')
    expect(state.nodes.get('A')?.content).toBe('a-branch');

    // layout: 静かな LWW。clock 最大の branch 値。対立には含めない
    expect(state.layout.get('A')).toEqual({
      x: 99,
      y: 99,
      w: undefined,
      h: undefined,
    });
    expect(conflicts.some((c) => c.category === 'layout')).toBe(false);

    // structure: OR-Set。新規 D はマージ後も存在
    expect(state.nodes.has('D')).toBe(true);
  });

  test('3. 複合イベント: group / paste を基本 op 列に分解して projection できる', () => {
    const tick = makeClock();
    const meta = tick('local');

    // 既存ノード X, Y を group 化
    const seed: Event[] = [
      {
        ...meta('structure'),
        op: { kind: 'node.add', target: 'X', content: 'x' },
      },
      {
        ...meta('structure'),
        op: { kind: 'node.add', target: 'Y', content: 'y' },
      },
    ];
    const groupOps = decomposeGroup(
      'G',
      ['X', 'Y'],
      { x: 0, y: 0, w: 200, h: 200 },
      meta,
    );

    const grouped = project([...seed, ...groupOps]);
    expect(grouped.nodes.get('G')?.isGroup).toBe(true);
    expect(grouped.nodes.get('X')?.parent).toBe('G');
    expect(grouped.nodes.get('Y')?.parent).toBe('G');
    expect(grouped.layout.get('G')).toEqual({ x: 0, y: 0, w: 200, h: 200 });

    // paste: 2 ノード + 1 エッジ
    const pasteOps = decomposePaste(
      [
        { id: 'P1', content: 'p1' },
        { id: 'P2', content: 'p2' },
      ],
      [{ id: 'PE', source: 'P1', dest: 'P2' }],
      meta,
    );
    const pasted = project([...seed, ...groupOps, ...pasteOps]);
    expect(pasted.nodes.has('P1')).toBe(true);
    expect(pasted.nodes.has('P2')).toBe(true);
    expect(pasted.edges.get('PE')).toEqual({
      id: 'PE',
      source: 'P1',
      dest: 'P2',
    });
  });
});
