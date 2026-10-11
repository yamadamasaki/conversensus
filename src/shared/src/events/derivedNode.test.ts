import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  type EdgeId,
  EdgeIdSchema,
  type FileId,
  FileIdSchema,
  type NodeId,
  NodeIdSchema,
  type Sheet,
  type SheetId,
  SheetIdSchema,
} from '../schemas';
import {
  DERIVED_FROM_SHEET_PROPERTY,
  derivedNodeIdOf,
  derivedNodesFor,
  placeDerivedNodes,
  refreshDerivedNodes,
} from './derivedNode';
import { projectFile } from './project';
import { METAGRAPH_SHEET_KIND, SHEET_KIND_PROPERTY } from './sheetKind';
import { type Batch, BatchIdSchema, nodeSetLayoutOp, type Op } from './unified';

const FILE = FileIdSchema.parse(
  '00000000-0000-4000-8000-00000000f11e',
) as FileId;
const META = SheetIdSchema.parse('00000000-0000-4000-8000-0000000000aa');
/** 導出 node にする sheet のプール。**小さくする** — 作る・消す・作り直すが同じ sheet に重なる */
const SHEETS = [
  SheetIdSchema.parse('00000000-0000-4000-8000-000000000001'),
  SheetIdSchema.parse('00000000-0000-4000-8000-000000000002'),
  SheetIdSchema.parse('00000000-0000-4000-8000-000000000003'),
] as const;

let n = 0;
const nextId = () =>
  BatchIdSchema.parse(
    `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  );

/** file 構造の batch (sheetId を持たない) */
const fileBatch = (clock: number, ops: Op[], actor = 'a#dev'): Batch => ({
  id: nextId(),
  actor,
  clock,
  seq: clock,
  deps: {},
  timestamp: clock,
  ops,
});

/** metagraph の中身の batch */
const inMeta = (clock: number, ops: Op[], actor = 'a#dev'): Batch => ({
  ...fileBatch(clock, ops, actor),
  sheetId: META,
});

/** metagraph を作る (clock 1, 2) */
const metagraph = (): Batch[] => [
  fileBatch(1, [{ kind: 'sheet.create', target: META, name: 'メタ' }]),
  fileBatch(2, [
    {
      kind: 'sheet.setProperty',
      target: META,
      name: SHEET_KIND_PROPERTY,
      value: METAGRAPH_SHEET_KIND,
    },
  ]),
];

/**
 * metagraph の姿。**metagraph 自身の導出 node は外して返す** — 自身が出ること (Q4) は専用の件が見る。
 * ほかの件は、ほかの sheet の導出 node と、ふつうの node・edge の扱いを見るので、自身の node が
 * 混ざると比べる相手が全部ずれる
 */
const metaSheetOf = (batches: Batch[], keepSelf = false): Sheet => {
  const sheet = projectFile(batches, FILE).sheets.find((s) => s.id === META);
  if (!sheet) throw new Error('metagraph が無い');
  if (keepSelf) return sheet;
  const self = derivedNodeIdOf(META);
  return {
    ...sheet,
    nodes: sheet.nodes.filter((n) => n.id !== self),
    layouts: (sheet.layouts ?? []).filter((l) => l.nodeId !== self),
  };
};

const [S1, S2] = SHEETS;
const D1 = derivedNodeIdOf(S1);
const D2 = derivedNodeIdOf(S2);
const edgeId = (k: number) =>
  EdgeIdSchema.parse(`00000000-0000-4000-8000-${String(k).padStart(12, '0')}`);

describe('derivedNodeIdOf', () => {
  test('SheetId から決定的に作る (誰の手元でも同じ id)', () => {
    expect(derivedNodeIdOf(S1)).toBe(derivedNodeIdOf(S1));
    expect(derivedNodeIdOf(S1)).not.toBe(derivedNodeIdOf(S2));
  });

  test('NodeId として有効 (edge の端点の型を変えずに済む)', () => {
    expect(NodeIdSchema.safeParse(derivedNodeIdOf(S1)).success).toBe(true);
  });
});

describe('derivedNodesFor', () => {
  test('在る sheet は名前を content にした node、消えた sheet は vanished になる', () => {
    const derived = derivedNodesFor([{ id: S1, name: '一' }], [S1, S2]);
    expect(derived.live.get(D1)).toEqual({
      id: D1,
      content: '一',
      properties: { [DERIVED_FROM_SHEET_PROPERTY]: S1 },
    });
    expect([...derived.vanished]).toEqual([D2]);
  });
});

describe('metagraph の導出 node (projectFile)', () => {
  test('File の sheet が node として出る。metagraph 自身も出る (step3 Phase 4 Q4)', () => {
    const sheet = metaSheetOf(
      [
        ...metagraph(),
        fileBatch(3, [{ kind: 'sheet.create', target: S1, name: '一' }]),
      ],
      true,
    );
    expect(sheet.nodes.map((node) => [node.id, node.content]).sort()).toEqual(
      [
        [derivedNodeIdOf(META), 'メタ'],
        [D1, '一'],
      ].sort(),
    );
  });

  test('ふつうの sheet には導出 node が出ない (種別が metagraph の sheet だけ)', () => {
    const file = projectFile(
      [
        fileBatch(1, [{ kind: 'sheet.create', target: META, name: '普通' }]),
        fileBatch(3, [{ kind: 'sheet.create', target: S1, name: '一' }]),
      ],
      FILE,
    );
    expect(file.sheets.find((s) => s.id === META)?.nodes).toEqual([]);
  });

  test('名前は sheet 側が正 — sheet.setName が node の content になる', () => {
    const sheet = metaSheetOf([
      ...metagraph(),
      fileBatch(3, [{ kind: 'sheet.create', target: S1, name: '一' }]),
      fileBatch(4, [{ kind: 'sheet.setName', target: S1, name: '改名' }]),
    ]);
    expect(sheet.nodes[0]?.content).toBe('改名');
  });

  test('🔴 導出 node への node.setContent / node.remove は効かない', () => {
    // 名前と在否の正は sheet 側である。node の op で変えられると、sheet と食い違う。
    // edge を張っておくのは、node.remove が効いてしまうとカスケードで edge が消えるから
    // (導出 node 自体は畳み込みの最後に足すので、node だけを見ても変化が見えない)
    const e = edgeId(4);
    const sheet = metaSheetOf([
      ...metagraph(),
      fileBatch(3, [
        { kind: 'sheet.create', target: S1, name: '一' },
        { kind: 'sheet.create', target: S2, name: '二' },
      ]),
      inMeta(4, [
        { kind: 'edge.add', target: e, source: D1, dest: D2 },
        { kind: 'node.setContent', target: D1, content: '書き換え' },
      ]),
      inMeta(5, [{ kind: 'node.remove', target: D1 }]),
    ]);
    expect(sheet.nodes.map((node) => node.content).sort()).toEqual([
      '一',
      '二',
    ]);
    expect(sheet.edges.map((edge) => edge.id)).toEqual([e]);
  });

  test('🔴 node.add の無い導出 node への node.setLayout と edge を受け付ける', () => {
    const e = edgeId(1);
    const sheet = metaSheetOf([
      ...metagraph(),
      fileBatch(3, [
        { kind: 'sheet.create', target: S1, name: '一' },
        { kind: 'sheet.create', target: S2, name: '二' },
      ]),
      inMeta(4, [
        { kind: 'node.setLayout', target: D1, x: 10, y: 20 },
        { kind: 'edge.add', target: e, source: D1, dest: D2 },
      ]),
    ]);
    expect(sheet.layouts).toEqual([{ nodeId: D1, x: 10, y: 20 }]);
    expect(sheet.edges.map((edge) => edge.id)).toEqual([e]);
  });

  test('🔴 sheet が消えれば、その導出 node への layout と edge も消え、作り直せば戻る', () => {
    const e = edgeId(1);
    const base = [
      ...metagraph(),
      fileBatch(3, [
        { kind: 'sheet.create', target: S1, name: '一' },
        { kind: 'sheet.create', target: S2, name: '二' },
      ]),
      inMeta(4, [
        { kind: 'node.setLayout', target: D1, x: 10, y: 20 },
        { kind: 'edge.add', target: e, source: D1, dest: D2 },
      ]),
      fileBatch(5, [{ kind: 'sheet.remove', target: S1 }]),
    ];
    const removed = metaSheetOf(base);
    expect(removed.nodes.map((node) => node.id)).toEqual([D2]);
    expect(removed.edges).toEqual([]);
    expect(removed.layouts).toEqual([]);

    // sheet.create は add-wins。作り直せば、畳み直しで layout と edge も戻る
    const recreated = metaSheetOf([
      ...base,
      fileBatch(6, [{ kind: 'sheet.create', target: S1, name: '一again' }]),
    ]);
    expect(recreated.edges.map((edge) => edge.id)).toEqual([e]);
    expect(recreated.layouts).toEqual([{ nodeId: D1, x: 10, y: 20 }]);
  });

  /**
   * 性質テストが見つけた反例。導出 node の id は SheetId から一方向に作るので、まだ届いて
   * いない sheet の導出 node は見分けられない。edge が sheet.create より先に届くと、端点の
   * 無い edge が live に残っていた。metagraph では「端点が live な node か」で判定する
   */
  test('🔴 まだ作られていない sheet の導出 node への edge は live にせず、作られれば出る', () => {
    const e = edgeId(3);
    const early = [
      ...metagraph(),
      inMeta(3, [{ kind: 'edge.add', target: e, source: D1, dest: D1 }]),
    ];
    expect(metaSheetOf(early).edges).toEqual([]);
    const created = metaSheetOf([
      ...early,
      fileBatch(4, [{ kind: 'sheet.create', target: S1, name: '一' }]),
    ]);
    expect(created.edges.map((edge) => edge.id)).toEqual([e]);
  });

  test('ふつうの node と edge は今までどおり置ける (保存するのは graph node 以外)', () => {
    const plain = NodeIdSchema.parse('00000000-0000-4000-8000-0000000000bb');
    const e = edgeId(2);
    const sheet = metaSheetOf([
      ...metagraph(),
      fileBatch(3, [{ kind: 'sheet.create', target: S1, name: '一' }]),
      inMeta(4, [
        { kind: 'node.add', target: plain, content: 'メモ' },
        { kind: 'edge.add', target: e, source: plain, dest: D1 },
      ]),
    ]);
    expect(sheet.nodes.map((node) => node.content).sort()).toEqual([
      'メモ',
      '一',
    ]);
    expect(sheet.edges.map((edge) => edge.id)).toEqual([e]);
  });
});

// --- 性質 ---
//
// **生成器は sheet のプールを 3 つに絞る。**作る・消す・作り直すが同じ sheet に重なり、
// 「消えた後の layout / edge」「作り直した後に戻る」を引く。edge の id は操作ごとに別に
// する — 同じ id の付け替えは導出 node の問いではなく、畳み込みの LWW の問いだからである。
// 導出 node への setContent / remove も混ぜる (効かないことが命題の一部)

type Step =
  | { t: 'create'; i: number; name: string }
  | { t: 'remove'; i: number }
  | { t: 'rename'; i: number; name: string }
  | { t: 'layout'; i: number; x: number }
  | { t: 'edge'; i: number; j: number }
  | { t: 'setContent'; i: number }
  | { t: 'removeNode'; i: number };

const idx = fc.integer({ min: 0, max: SHEETS.length - 1 });
const name = fc.constantFrom('あ', 'い');
const arbStep: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ t: fc.constant('create' as const), i: idx, name }),
  fc.record({ t: fc.constant('remove' as const), i: idx }),
  fc.record({ t: fc.constant('rename' as const), i: idx, name }),
  fc.record({
    t: fc.constant('layout' as const),
    i: idx,
    x: fc.integer({ min: 0, max: 99 }),
  }),
  fc.record({ t: fc.constant('edge' as const), i: idx, j: idx }),
  fc.record({ t: fc.constant('setContent' as const), i: idx }),
  fc.record({ t: fc.constant('removeNode' as const), i: idx }),
);
/** clock は小さく引いて同値を出す。同じ clock は actor で順序が決まる */
const arbTimed = fc.tuple(
  arbStep,
  fc.integer({ min: 3, max: 12 }),
  fc.constantFrom('a#dev', 'b#dev'),
);

function build(timed: [Step, number, string][]) {
  const batches = metagraph();
  const edges: { id: EdgeId; i: number; j: number }[] = [];
  const laidOut = new Set<number>();
  timed.forEach(([step, clock, actor], k) => {
    const s = SHEETS[step.i] as SheetId;
    const d: NodeId = derivedNodeIdOf(s);
    switch (step.t) {
      case 'create':
        batches.push(
          fileBatch(
            clock,
            [{ kind: 'sheet.create', target: s, name: step.name }],
            actor,
          ),
        );
        break;
      case 'remove':
        batches.push(
          fileBatch(clock, [{ kind: 'sheet.remove', target: s }], actor),
        );
        break;
      case 'rename':
        batches.push(
          fileBatch(
            clock,
            [{ kind: 'sheet.setName', target: s, name: step.name }],
            actor,
          ),
        );
        break;
      case 'layout':
        laidOut.add(step.i);
        batches.push(
          inMeta(
            clock,
            [{ kind: 'node.setLayout', target: d, x: step.x, y: 0 }],
            actor,
          ),
        );
        break;
      case 'edge': {
        const id = edgeId(100 + k);
        edges.push({ id, i: step.i, j: step.j });
        batches.push(
          inMeta(
            clock,
            [
              {
                kind: 'edge.add',
                target: id,
                source: d,
                dest: derivedNodeIdOf(SHEETS[step.j] as SheetId),
              },
            ],
            actor,
          ),
        );
        break;
      }
      case 'setContent':
        batches.push(
          inMeta(
            clock,
            [{ kind: 'node.setContent', target: d, content: '書き換え' }],
            actor,
          ),
        );
        break;
      case 'removeNode':
        batches.push(
          inMeta(clock, [{ kind: 'node.remove', target: d }], actor),
        );
        break;
    }
  });
  return { batches, edges, laidOut };
}

describe('性質: 導出 node への op は sheet が在る限り受け付け、無ければ捨てる (D8)', () => {
  test('∀ 履歴. 導出 node・layout・edge が、いま在る sheet とちょうど対応する', () => {
    fc.assert(
      fc.property(fc.array(arbTimed, { maxLength: 20 }), (timed) => {
        const { batches, edges, laidOut } = build(timed);
        const file = projectFile(batches, FILE);
        const meta = metaSheetOf(batches);

        // いま在る sheet (metagraph 以外) は、projection の sheet の一覧が正である。
        // metagraph 自身の導出 node は `metaSheetOf` が外している (自身が出ることは別の件が見る)
        const live = new Map(
          file.sheets.filter((s) => s.id !== META).map((s) => [s.id, s.name]),
        );
        const liveIndex = (i: number) => live.has(SHEETS[i] as SheetId);

        // 1. 導出 node はいま在る sheet とちょうど対応し、content は sheet の名前である
        //    (導出 node への setContent / remove は効かない)
        expect(
          new Map(meta.nodes.map((node) => [node.id, node.content])),
        ).toEqual(
          new Map(
            [...live].map(([id, sheetName]) => [
              derivedNodeIdOf(id),
              sheetName,
            ]),
          ),
        );

        // 2. edge は両端の sheet が在る ⇔ live
        const liveEdges = new Set(meta.edges.map((edge) => edge.id));
        for (const edge of edges) {
          expect(liveEdges.has(edge.id)).toBe(
            liveIndex(edge.i) && liveIndex(edge.j),
          );
        }

        // 3. layout は sheet が在り、位置を置いたことがある ⇔ live
        const liveLayouts = new Set(meta.layouts?.map((l) => l.nodeId));
        SHEETS.forEach((s, i) => {
          expect(liveLayouts.has(derivedNodeIdOf(s))).toBe(
            liveIndex(i) && laidOut.has(i),
          );
        });
      }),
    );
  });
});

/** 比べるために並びを揃える (導き直しと projection で node・edge・layout の並びは違いうる) */
const normalize = (sheet: Sheet) => ({
  nodes: [...sheet.nodes].sort((a, b) => a.id.localeCompare(b.id)),
  edges: [...sheet.edges].sort((a, b) => a.id.localeCompare(b.id)),
  layouts: [...(sheet.layouts ?? [])].sort((a, b) =>
    a.nodeId.localeCompare(b.nodeId),
  ),
});

describe('性質: 画面の側の導き直し (step3 Phase 4 S4-2)', () => {
  test('∀ 履歴. projection と同じ sheet の一覧で導き直すと、projection の姿そのものに戻る', () => {
    fc.assert(
      fc.property(fc.array(arbTimed, { maxLength: 20 }), (timed) => {
        const { batches } = build(timed);
        const file = projectFile(batches, FILE);
        const meta = metaSheetOf(batches, true);
        expect(normalize(refreshDerivedNodes(meta, file.sheets))).toEqual(
          normalize(meta),
        );
      }),
    );
  });

  /**
   * 3 つの sheet を先に作り、すべての組に edge を張る前置き。ランダムな歴史だけだと、消す sheet の
   * 導出 node に繋がった**生きている** edge を 100 回に 1 回しか引かない (2026-10-03 に数えた)。
   * それでは「消えた端点の edge を外す」を試さない
   */
  const prelude: [Step, number, string][] = [
    ...SHEETS.map((_, i): [Step, number, string] => [
      { t: 'create', i, name: 'あ' },
      3,
      'a#dev',
    ]),
    ...SHEETS.flatMap((_, i) =>
      SHEETS.map((_, j): [Step, number, string] => [
        { t: 'edge', i, j },
        4,
        'a#dev',
      ]),
    ),
  ];

  test('∀ 履歴・消す sheet. 一覧から外して導き直した姿 = sheet.remove を積んで projection した姿', () => {
    fc.assert(
      fc.property(fc.array(arbTimed, { maxLength: 20 }), idx, (timed, i) => {
        const { batches } = build([...prelude, ...timed]);
        const target = SHEETS[i] as SheetId;
        const file = projectFile(batches, FILE);
        const refreshed = refreshDerivedNodes(
          metaSheetOf(batches, true),
          file.sheets.filter((s) => s.id !== target),
        );
        const removed = metaSheetOf(
          [...batches, fileBatch(10_000, [{ kind: 'sheet.remove', target }])],
          true,
        );
        expect(normalize(refreshed)).toEqual(normalize(removed));
      }),
    );
  });
});

describe('placeDerivedNodes', () => {
  test('置き場所の無い導出 node にだけ置き場所を与え、互いに重ならない。既にある置き場所は変えない', () => {
    const sheet = metaSheetOf(
      [
        ...metagraph(),
        fileBatch(3, [{ kind: 'sheet.create', target: S1, name: '一' }]),
        fileBatch(4, [{ kind: 'sheet.create', target: S2, name: '二' }]),
        inMeta(5, [nodeSetLayoutOp(D1, { x: 10, y: 20 })]),
      ],
      true,
    );
    const placed = placeDerivedNodes(sheet);
    expect(placed.layouts?.find((l) => l.nodeId === D1)).toEqual({
      nodeId: D1,
      x: 10,
      y: 20,
    });
    const ids = sheet.nodes.map((n) => n.id);
    expect(new Set(placed.layouts?.map((l) => l.nodeId))).toEqual(new Set(ids));
    const spots = (placed.layouts ?? []).map((l) => `${l.x},${l.y}`);
    expect(new Set(spots).size).toBe(spots.length);
  });

  // #257: 以前は「置かれた要素のいちばん下のさらに下」から並べたので、graph node を 1 つ
  // 置くと、置き場所の無い node が全部その下へ跳んだ
  test('空いた所に graph node を置いても、ほかの node の並べた場所は動かない (#257)', () => {
    const base = [
      ...metagraph(),
      fileBatch(3, [{ kind: 'sheet.create', target: S1, name: '一' }]),
      fileBatch(4, [{ kind: 'sheet.create', target: S2, name: '二' }]),
    ];
    const before = placeDerivedNodes(metaSheetOf(base, true));
    const after = placeDerivedNodes(
      metaSheetOf(
        [...base, inMeta(5, [nodeSetLayoutOp(D2, { x: 900, y: 600 })])],
        true,
      ),
    );
    const at = (sheet: Sheet, id: string) =>
      sheet.layouts?.find((l) => l.nodeId === id);
    for (const n of after.nodes.filter((n) => n.id !== D2)) {
      expect(at(after, n.id)).toEqual(at(before, n.id));
    }
    expect(at(after, D2)).toMatchObject({ x: 900, y: 600 });
  });

  test('並べた場所は、置かれた node と重ならない (どこに置かれていても)', () => {
    const base = [
      ...metagraph(),
      fileBatch(3, [{ kind: 'sheet.create', target: S1, name: '一' }]),
      fileBatch(4, [{ kind: 'sheet.create', target: S2, name: '二' }]),
    ];
    fc.assert(
      fc.property(
        fc.integer({ min: -100, max: 700 }),
        fc.integer({ min: -100, max: 400 }),
        (x, y) => {
          const sheet = placeDerivedNodes(
            metaSheetOf(
              [...base, inMeta(5, [nodeSetLayoutOp(D1, { x, y })])],
              true,
            ),
          );
          const auto = (sheet.layouts ?? []).filter((l) => l.nodeId !== D1);
          return auto.every(
            (l) =>
              Math.abs((l.x ?? 0) - x) >= 160 || Math.abs((l.y ?? 0) - y) >= 80,
          );
        },
      ),
    );
  });

  test('置き場所が全部あれば何もしない', () => {
    const sheet = metaSheetOf([...metagraph()], true);
    const once = placeDerivedNodes(sheet);
    expect(placeDerivedNodes(once)).toBe(once);
  });
});
