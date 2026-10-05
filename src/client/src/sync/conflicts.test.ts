import { describe, expect, test } from 'bun:test';
import type {
  Batch,
  Did,
  EdgeId,
  MergeConflict,
  NodeId,
  Op,
  SheetId,
} from '@conversensus/shared';
import {
  CausalClock,
  concurrent,
  orderBatches,
  projectBatches,
} from '@conversensus/shared';
import fc from 'fast-check';
import { detectIncomingConflicts, labelsOfConflicts } from './conflicts';
import { detectOverwrites } from './overwrites';

const SHEET = 'sheet-1' as SheetId;
const A = 'aaaaaaaa-0000-4000-8000-000000000000' as NodeId;
const B = 'bbbbbbbb-0000-4000-8000-000000000000' as NodeId;
const CHILD = 'cccccccc-0000-4000-8000-000000000000' as NodeId;
const E = 'eeeeeeee-0000-4000-8000-000000000000' as EdgeId;

/**
 * seq は clock と同じにしておく (actor ごとに増えればよい)。`deps` は**その batch を書いた
 * ときに見ていたもの**で、競合か否かはこれで決まる (step3 Phase 1 D4)
 */
const batch = (
  id: string,
  actor: string,
  clock: number,
  ops: Op[],
  deps: Batch['deps'] = {},
): Batch => ({
  id: id as Batch['id'],
  actor,
  clock,
  seq: clock,
  deps,
  timestamp: clock,
  sheetId: SHEET,
  ops,
});

/** 「私」の手元にある op-log (自分の編集 + 前のサイクルで受け取った相手の分) */
const ALICE_DEV = 'did:plc:alice#dev';

/** 相手が l1 (A と B を作ったところ) までを見ていた */
const SAW_L1 = { [ALICE_DEV]: 1 };

const localLog = (): Batch[] => [
  batch('l1', ALICE_DEV, 1, [
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
    // bob は l1 までしか見ていない = **私の l2 を見ずに書いた** (並行)
    const local = [
      ...localLog(),
      batch('l2', 'did:plc:alice#dev', 4, [
        { kind: 'node.setContent', target: A, content: '私の編集' },
      ]),
    ];
    const incoming = [
      batch(
        'r1',
        'did:plc:bob#dev',
        4,
        [{ kind: 'node.setContent', target: A, content: 'bob の編集' }],
        SAW_L1,
      ),
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
      batch(
        'r1',
        'did:plc:bob#dev',
        4,
        [{ kind: 'node.remove', target: A }],
        SAW_L1,
      ),
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
      batch(
        'r1',
        'did:plc:bob#dev',
        4,
        [{ kind: 'node.remove', target: A }],
        SAW_L1,
      ),
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
      batch(
        'r1',
        'did:plc:bob#dev',
        4,
        [{ kind: 'node.remove', target: A }],
        SAW_L1,
      ),
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
      batch(
        'r1',
        'did:plc:bob#dev',
        4,
        [{ kind: 'node.setLayout', target: A, x: 9, y: 9 }],
        SAW_L1,
      ),
    ];
    const { conflicts } = detectIncomingConflicts(local, incoming);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      category: 'layout',
      aspect: 'position',
    });
  });

  /**
   * **組を因果で絞る理由そのもの。**step2 の実装の途中でこれを踏んだ — 手元の op を
   * 全部 ours にすると、順次編集がすべて競合になった。
   */
  test('🔴 相手が私のを読んで直しただけなら競合にしない (順次編集)', () => {
    const local = [
      ...localLog(),
      batch('l2', ALICE_DEV, 2, [
        { kind: 'node.setContent', target: A, content: '私が先に書いた' },
      ]),
    ];
    // bob は l2 を見た上で直した
    const incoming = [
      batch(
        'r1',
        'did:plc:bob#dev',
        50,
        [{ kind: 'node.setContent', target: A, content: 'bob が読んで直した' }],
        { [ALICE_DEV]: 2 },
      ),
    ];
    expect(detectIncomingConflicts(local, incoming).conflicts).toEqual([]);
  });

  /**
   * step2 は境界を clock で引いていたので、**clock が小さい側は並行でも検出できなかった**
   * (Lamport の対偶は片側でしか言えない)。並行は対称なので、いまは両方で出る
   */
  test('🔴 並行なら clock の大小によらず、両方の手元で検出する', () => {
    const mine = batch('l2', ALICE_DEV, 3, [
      { kind: 'node.setContent', target: A, content: '私' },
    ]);
    const theirs = batch(
      'r1',
      'did:plc:bob#dev',
      7,
      [{ kind: 'node.setContent', target: A, content: 'bob' }],
      SAW_L1,
    );
    // 私の手元 (clock の小さい側)。step2 ではここが空だった
    expect(
      detectIncomingConflicts([...localLog(), mine], [theirs]).conflicts,
    ).toHaveLength(1);
    // bob の手元
    expect(
      detectIncomingConflicts([...localLog(), theirs], [mine]).conflicts,
    ).toHaveLength(1);
  });

  test('🔴 clock が大きくても、相手が見ていたなら競合にしない', () => {
    // step2 の境界 (clock(私) >= clock(新着) なら並行) が誤る向き。私の clock は大きいが、
    // bob の deps は私の編集を含む — Lamport の clock は因果の必要条件でしかない
    const local = [
      ...localLog(),
      batch('l2', ALICE_DEV, 9, [
        { kind: 'node.setContent', target: A, content: '私' },
      ]),
    ];
    const incoming = [
      batch(
        'r1',
        'did:plc:bob#dev',
        9,
        [{ kind: 'node.setContent', target: A, content: 'bob' }],
        { [ALICE_DEV]: 9 },
      ),
    ];
    expect(detectIncomingConflicts(local, incoming).conflicts).toEqual([]);
  });

  test('新着の方が前 (知っていたが遅れて届いた) なら競合にしない', () => {
    // 私は carol 経由で bob の r1 を知った上で書いた (deps に入っている)。r1 そのものは
    // 後から届いた。私が r1 を見た上で書いているので、並行ではない
    const local = [
      ...localLog(),
      batch(
        'l2',
        ALICE_DEV,
        8,
        [{ kind: 'node.setContent', target: A, content: '私' }],
        { 'did:plc:bob#dev': 5 },
      ),
    ];
    const incoming = [
      batch('r1', 'did:plc:bob#dev', 5, [
        { kind: 'node.setContent', target: A, content: 'bob' },
      ]),
    ];
    expect(detectIncomingConflicts(local, incoming).conflicts).toEqual([]);
  });
});

/** 2 台の端末の履歴。書く・相手の分を全部受け取る、を任意の順に並べる */
type Step = 'aliceWrites' | 'bobWrites' | 'aliceReceives' | 'bobReceives';

type Device = { causal: CausalClock; batches: Batch[] };

const genesis = batch('g', 'genesis', 1, [
  { kind: 'node.add', target: A, content: 'A' },
]);

function device(actor: string): Device {
  const causal = new CausalClock(actor);
  causal.observe(genesis);
  return { causal, batches: [genesis] };
}

function write(d: Device): Batch {
  const stamp = d.causal.issue();
  const b: Batch = {
    id: `${d.causal.actor}-${stamp.seq}` as Batch['id'],
    actor: d.causal.actor,
    ...stamp,
    timestamp: stamp.clock,
    sheetId: SHEET,
    // 値は毎回違う。同じ値だと「差が無い」として組にならない
    ops: [
      {
        kind: 'node.setContent',
        target: A,
        content: `${d.causal.actor} ${stamp.seq}`,
      },
    ],
  };
  d.batches.push(b);
  return b;
}

/** 受け取りのたびに、組がどちらの側に振られたか */
type Verdicts = Map<string, 'conflict' | 'overwrite'>;

/** 組の同一性。ours / theirs は手元によって入れ替わるので、整列して繋ぐ */
const pairKey = (x: string, y: string) => [x, y].sort().join('|');

/** 単位 A の、いまの値を書いた batch (全順序で最後のもの) */
const currentWriterOf = (batches: Batch[]): Batch | undefined =>
  orderBatches([...batches])
    .filter((b) => b.ops.some((op) => 'target' in op && op.target === A))
    .at(-1);

/**
 * 相手の分を全部受け取る。**追記の前に**競合と上書きを検出し (受信と同じ順序)、
 * 組の振り分けを `verdicts` に記録する
 */
function receive(
  to: Device,
  from: Device,
  viewer: Did,
  verdicts: Verdicts,
): void {
  const known = new Set(to.batches.map((b) => b.id));
  const incoming = from.batches.filter((b) => !known.has(b.id));
  if (incoming.length === 0) return;

  const { conflicts } = detectIncomingConflicts(to.batches, incoming);
  const { reports } = detectOverwrites(to.batches, incoming, viewer);
  const record = (key: string, verdict: 'conflict' | 'overwrite') => {
    // **排他**: 同じ組が、別の端末・別の受け取りで反対の側に振られない
    expect(verdicts.get(key) ?? verdict).toBe(verdict);
    verdicts.set(key, verdict);
  };
  for (const c of conflicts) {
    record(pairKey(c.ours.batchId, c.theirs.batchId), 'conflict');
  }
  for (const r of reports) record(pairKey(r.mine, r.theirs), 'overwrite');

  // **完全**: いまの値と並行な新着は、どれも競合として出る (clock の大小によらない)
  const current = currentWriterOf(to.batches);
  if (current !== undefined) {
    const found = new Set(
      conflicts.map((c) => pairKey(c.ours.batchId, c.theirs.batchId)),
    );
    for (const t of incoming) {
      if (concurrent(current, t)) {
        expect(found).toContain(pairKey(current.id, t.id));
      }
    }
  }

  for (const b of incoming) {
    to.batches.push(b);
    to.causal.observe(b);
  }
}

describe('競合と上書きの境界は因果で引く (step3 Phase 1 D4)', () => {
  /**
   * 生成器は 4 つの動作だけを引く。**受け取りは「相手の分を全部」**に限る — 部分的な
   * 受け取りは参加者間の配送の話で、ここで見たいのは「相手の編集を見たか」だけだから
   * である。受け取りを混ぜることで、clock が片側に偏る履歴が出る (受け取った側は clock が
   * 跳ぶ)。step2 の境界 (新着の最小 clock) はそこで、clock の小さい側の並行を取り逃した。
   *
   * **値は毎回違う**ものを書く。同じ値だと「差が無い」として組にならず、検出の対象から
   * 外れてしまう
   */
  const arbSteps = fc.array(
    fc.constantFrom<Step>(
      'aliceWrites',
      'bobWrites',
      'aliceReceives',
      'bobReceives',
    ),
    { maxLength: 16 },
  );

  test('どの履歴でも、同じ組は常に同じ側に振られ、いまの値と並行な新着は必ず競合になる', () => {
    fc.assert(
      fc.property(arbSteps, (steps) => {
        const alice = device(ALICE_DEV);
        const bob = device('did:plc:bob#dev');
        const verdicts: Verdicts = new Map();
        for (const s of steps) {
          if (s === 'aliceWrites') write(alice);
          if (s === 'bobWrites') write(bob);
          if (s === 'aliceReceives')
            receive(alice, bob, 'did:plc:alice' as Did, verdicts);
          if (s === 'bobReceives')
            receive(bob, alice, 'did:plc:bob' as Did, verdicts);
        }
      }),
    );
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

  test('ラベルがあれば「ラベル: 本文の先頭」にする (Phase 5 P7)', () => {
    const g = projectBatches([
      batch('b1', 'a', 1, [
        {
          kind: 'node.add',
          target: A,
          content: '気温の記録は信頼できない',
          label: '反論',
        },
      ]),
    ]);
    expect(labelsOfConflicts(g, [conflictOn(A)]).get(A)).toBe(
      '反論: 気温の記録は信頼できない',
    );
  });

  test('本文が長ければ先頭だけにする — 通知の 1 行に収める', () => {
    const long = 'あ'.repeat(30);
    const g = projectBatches([
      batch('b1', 'a', 1, [
        { kind: 'node.add', target: A, content: long, label: '主張' },
      ]),
    ]);
    const name = labelsOfConflicts(g, [conflictOn(A)]).get(A) ?? '';
    expect(name).toBe(`主張: ${'あ'.repeat(20)}…`);
  });

  test('切っていなければ … を付けない', () => {
    const g = projectBatches([
      batch('b1', 'a', 1, [
        { kind: 'node.add', target: A, content: 'あ'.repeat(20) },
      ]),
    ]);
    expect(labelsOfConflicts(g, [conflictOn(A)]).get(A)).not.toContain('…');
  });

  test('ラベルが空なら「: 」を出さない', () => {
    // 空のラベルで区切りだけが浮くと、名前が壊れて見える
    const g = projectBatches([
      batch('b1', 'a', 1, [
        { kind: 'node.add', target: A, content: '本文', label: '' },
      ]),
    ]);
    expect(labelsOfConflicts(g, [conflictOn(A)]).get(A)).toBe('本文');
  });

  test('edge は label のまま — 種類名そのものが名前である', () => {
    const g = projectBatches([
      batch('b1', 'a', 1, [
        { kind: 'node.add', target: A, content: 'A' },
        { kind: 'node.add', target: B, content: 'B' },
        { kind: 'edge.add', target: E, source: A, dest: B, label: '支える' },
      ]),
    ]);
    expect(labelsOfConflicts(g, [conflictOn(E)]).get(E)).toBe('支える');
  });

  test('分岐点に無い対象は入れない', () => {
    const unknown = 'dddddddd-0000-4000-8000-000000000000';
    const labels = labelsOfConflicts(base(), [conflictOn(unknown)]);
    expect(labels.has(unknown)).toBe(false);
  });
});

describe('知らない種類の op (step3 FPR の確認 §5.3)', () => {
  // FPR の後で足された op が、更新していない手元に届いた場合。受信はそれを保存するが
  // (`ReceivedBatchSchema`)、検出は知らない op を競合にも上書きにも数えず、例外も出さない
  const NODE = '22222222-2222-4222-8222-222222222222';
  const batch = (
    id: string,
    actor: string,
    seq: number,
    deps: Record<string, number>,
    ops: unknown[],
  ) =>
    ({
      id,
      actor,
      clock: seq,
      seq,
      deps,
      timestamp: seq,
      ops,
    }) as unknown as Batch;
  const genesis = batch(
    '11111111-1111-4111-8111-000000000001',
    'did:plc:a#d',
    1,
    {},
    [{ kind: 'node.add', target: NODE, content: 'x' }],
  );
  const mine = batch(
    '11111111-1111-4111-8111-000000000002',
    'did:plc:a#d',
    2,
    {},
    [{ kind: 'node.setContent', target: NODE, content: 'A' }],
  );
  const future = batch(
    '11111111-1111-4111-8111-000000000003',
    'did:plc:b#e',
    1,
    { 'did:plc:a#d': 1 },
    [{ kind: 'node.futureThing', target: NODE, content: 'B' }],
  );

  test('同じ対象に知らない op が並行に届いても、競合にも上書きにも数えない', () => {
    expect(
      detectIncomingConflicts([genesis, mine], [future]).conflicts,
    ).toEqual([]);
    expect(
      detectOverwrites([genesis, mine], [future], 'did:plc:a' as Did).reports,
    ).toEqual([]);
  });
});
