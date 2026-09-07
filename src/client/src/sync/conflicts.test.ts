import { describe, expect, test } from 'bun:test';
import type {
  Batch,
  EdgeId,
  MergeConflict,
  NodeId,
  Op,
  SheetId,
} from '@conversensus/shared';
import { projectBatches } from '@conversensus/shared';
import { detectIncomingConflicts, labelsOfConflicts } from './conflicts';

const SHEET = 'sheet-1' as SheetId;
const A = 'aaaaaaaa-0000-4000-8000-000000000000' as NodeId;
const B = 'bbbbbbbb-0000-4000-8000-000000000000' as NodeId;
const CHILD = 'cccccccc-0000-4000-8000-000000000000' as NodeId;
const E = 'eeeeeeee-0000-4000-8000-000000000000' as EdgeId;

const batch = (id: string, actor: string, clock: number, ops: Op[]): Batch => ({
  id: id as Batch['id'],
  actor,
  clock,
  timestamp: clock,
  sheetId: SHEET,
  ops,
});

/** 「私」の手元にある op-log (自分の編集 + 前のサイクルで受け取った相手の分) */
const localLog = (): Batch[] => [
  batch('l1', 'did:plc:alice#dev', 1, [
    { kind: 'node.add', target: A, content: 'A' },
    { kind: 'node.add', target: B, content: 'B' },
  ]),
];

describe('detectIncomingConflicts', () => {
  test('新着が無ければ検出もしない (毎サイクル走るので空振りを軽くする)', () => {
    const detected = detectIncomingConflicts(localLog(), []);
    expect(detected.conflicts).toEqual([]);
    expect(detected.labels.size).toBe(0);
  });

  test('手元と新着が別のものを触っていれば競合にしない', () => {
    const incoming = [
      batch('r1', 'did:plc:bob#dev', 5, [
        { kind: 'node.setContent', target: B, content: 'bob が B を編集' },
      ]),
    ];
    expect(detectIncomingConflicts(localLog(), incoming).conflicts).toEqual([]);
  });

  test('🔴 手元の編集と新着の編集がぶつかれば content の競合になる', () => {
    // 私の編集の clock (4) が新着 (4) 以上 = **bob は私の編集を見ていない**
    const local = [
      ...localLog(),
      batch('l2', 'did:plc:alice#dev', 4, [
        { kind: 'node.setContent', target: A, content: '私の編集' },
      ]),
    ];
    const incoming = [
      batch('r1', 'did:plc:bob#dev', 4, [
        { kind: 'node.setContent', target: A, content: 'bob の編集' },
      ]),
    ];
    const { conflicts } = detectIncomingConflicts(local, incoming);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ target: A, category: 'content' });
    // ours = 手元, theirs = 新着 (explicit merge の trunk / branch に対応する)
    expect(conflicts[0]?.ours.batchId).toBe('l2' as Batch['id']);
    expect(conflicts[0]?.theirs.batchId).toBe('r1' as Batch['id']);
  });

  test('🔴 新着の削除が、手元が前提にしているものを壊せば削除依存になる', () => {
    const local = [
      ...localLog(),
      batch('l2', 'did:plc:alice#dev', 5, [
        { kind: 'node.setContent', target: A, content: '私の編集' },
      ]),
    ];
    const incoming = [
      batch('r1', 'did:plc:bob#dev', 4, [{ kind: 'node.remove', target: A }]),
    ];
    const { conflicts } = detectIncomingConflicts(local, incoming);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      target: A,
      category: 'structure',
      kind: 'removeDependency',
    });
  });

  /**
   * 分岐点を受信前の手元の状態にしたことが効く 1 件。**カスケードは状態が無いと
   * 求まらない** — op に書かれているのは親の id だけである。
   */
  test('🔴 新着がグループを消し、手元が子を編集していれば検出する (カスケード)', () => {
    const local = [
      batch('l1', 'did:plc:alice#dev', 1, [
        { kind: 'node.add', target: A, content: 'グループ', nodeType: 'group' },
        { kind: 'node.add', target: CHILD, content: '子', parentId: A },
      ]),
      batch('l2', 'did:plc:alice#dev', 5, [
        { kind: 'node.setContent', target: CHILD, content: '子を編集' },
      ]),
    ];
    const incoming = [
      batch('r1', 'did:plc:bob#dev', 4, [{ kind: 'node.remove', target: A }]),
    ];
    const { conflicts } = detectIncomingConflicts(local, incoming);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.target).toBe(CHILD); // op に書かれているのは A だけ
  });

  test('🔴 消された対象の名前が分岐点から引ける', () => {
    // 削除依存の対象はまさに消された要素なので、適用後のグラフからは引けない
    const local = [
      ...localLog(),
      batch('l2', 'did:plc:alice#dev', 5, [
        { kind: 'node.setContent', target: A, content: '私の編集' },
      ]),
    ];
    const incoming = [
      batch('r1', 'did:plc:bob#dev', 4, [{ kind: 'node.remove', target: A }]),
    ];
    const { labels } = detectIncomingConflicts(local, incoming);
    // 分岐点 (= 受信前の手元) では A の content は「私の編集」である
    expect(labels.get(A)).toBe('私の編集');
  });

  test('layout の競合も拾う (通知だけの段)', () => {
    const local = [
      ...localLog(),
      batch('l2', 'did:plc:alice#dev', 5, [
        { kind: 'node.setLayout', target: A, x: 1, y: 1 },
      ]),
    ];
    const incoming = [
      batch('r1', 'did:plc:bob#dev', 4, [
        { kind: 'node.setLayout', target: A, x: 9, y: 9 },
      ]),
    ];
    const { conflicts } = detectIncomingConflicts(local, incoming);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      category: 'layout',
      aspect: 'position',
    });
  });

  /**
   * **ours を絞る理由そのもの。**実装の途中でこれを踏んだ — 手元の op を全部 ours に
   * すると、順次編集がすべて競合になった。
   */
  test('🔴 相手が私のを読んで直しただけなら競合にしない (順次編集)', () => {
    const local = [
      ...localLog(),
      batch('l2', 'did:plc:alice#dev', 2, [
        { kind: 'node.setContent', target: A, content: '私が先に書いた' },
      ]),
    ];
    // clock 50 = 私の編集を見た後の編集。Lamport の保証がそれを言っている
    const incoming = [
      batch('r1', 'did:plc:bob#dev', 50, [
        { kind: 'node.setContent', target: A, content: 'bob が読んで直した' },
      ]),
    ];
    expect(detectIncomingConflicts(local, incoming).conflicts).toEqual([]);
  });

  test('🔴 clock が小さい側は検出しないが、相手側は検出する (対で完全)', () => {
    // 私 (clock 3) と bob (clock 7) が並行に編集した。私の手元では出ないが…
    const mine = batch('l2', 'did:plc:alice#dev', 3, [
      { kind: 'node.setContent', target: A, content: '私' },
    ]);
    const theirs = batch('r1', 'did:plc:bob#dev', 7, [
      { kind: 'node.setContent', target: A, content: 'bob' },
    ]);
    expect(
      detectIncomingConflicts([...localLog(), mine], [theirs]).conflicts,
    ).toEqual([]);
    // …bob の手元 (ours = 自分の clock 7, theirs = 私の clock 3) では出る。
    // fork は競合そのものから同一性が導かれるので、bob の書いた fork が私にも届く
    expect(
      detectIncomingConflicts([...localLog(), theirs], [mine]).conflicts,
    ).toHaveLength(1);
  });
});

describe('labelsOfConflicts', () => {
  const conflictOn = (target: string): MergeConflict => ({
    target,
    category: 'content',
    ours: {
      batchId: 'x' as Batch['id'],
      op: { kind: 'node.setContent', target: A, content: 'x' },
    },
    theirs: {
      batchId: 'y' as Batch['id'],
      op: { kind: 'node.setContent', target: A, content: 'y' },
    },
  });

  const base = () =>
    projectBatches([
      batch('b1', 'a', 1, [
        { kind: 'node.add', target: A, content: 'ノードの名前' },
        { kind: 'node.add', target: B, content: '' },
        { kind: 'edge.add', target: E, source: A, dest: B, label: 'つながり' },
      ]),
    ]);

  test('node は content を、edge は label を返す', () => {
    const labels = labelsOfConflicts(base(), [conflictOn(A), conflictOn(E)]);
    expect(labels.get(A)).toBe('ノードの名前');
    expect(labels.get(E)).toBe('つながり');
  });

  test('空の名前はそのまま返す (言い換えは見せる側の判断)', () => {
    // 「名前が無い」と「引けなかった」は別の話である
    const labels = labelsOfConflicts(base(), [conflictOn(B)]);
    expect(labels.get(B)).toBe('');
  });

  test('分岐点に無い対象は入れない', () => {
    const unknown = 'dddddddd-0000-4000-8000-000000000000';
    const labels = labelsOfConflicts(base(), [conflictOn(unknown)]);
    expect(labels.has(unknown)).toBe(false);
  });
});
