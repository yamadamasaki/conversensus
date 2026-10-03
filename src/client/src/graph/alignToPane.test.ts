import { describe, expect, test } from 'bun:test';
import {
  type Batch,
  type EdgeId,
  type FileId,
  type NodeId,
  type Op,
  projectFile,
  type Sheet,
  type SheetId,
} from '@conversensus/shared';
import fc from 'fast-check';
import { graphEventToBatch } from '../events/toUnified';
import { alignToPane } from './alignToPane';

const FILE = '00000000-0000-4000-8000-0000000000f1' as FileId;
const SHEET = '00000000-0000-4000-8000-0000000000a1' as SheetId;
const ACTOR = 'did:plc:alice#dev-a';
/** node と edge の小さなプール。両方の姿で同じ要素を引き、在る/無い・値が違う場面に当たるため */
const NODES = [1, 2, 3].map(
  (n) => `00000000-0000-4000-8000-00000000000${n}` as NodeId,
);
const EDGES = [1, 2].map(
  (n) => `00000000-0000-4000-8000-0000000001${n}0` as EdgeId,
);
/** edge の端 (固定)。e1 = n1→n2, e2 = n2→n3 */
const ENDS: [NodeId, NodeId][] = [
  [NODES[0] as NodeId, NODES[1] as NodeId],
  [NODES[1] as NodeId, NODES[2] as NodeId],
];

type NodeSpec = {
  content: 'a' | 'b';
  label: '' | '主張';
  prop: boolean;
  x: 0 | 100;
} | null;
const arbNode: fc.Arbitrary<NodeSpec> = fc.option(
  fc.record({
    content: fc.constantFrom('a' as const, 'b' as const),
    label: fc.constantFrom('' as const, '主張' as const),
    prop: fc.boolean(),
    x: fc.constantFrom(0 as const, 100 as const),
  }),
);
const arbEdge = fc.option(fc.record({ label: fc.constantFrom('', '支える') }));
const arbSide = fc.record({
  nodes: fc.tuple(arbNode, arbNode, arbNode),
  edges: fc.tuple(arbEdge, arbEdge),
});
type Side = { nodes: NodeSpec[]; edges: ({ label: string } | null)[] };

/** 姿を op-log で組む (projection を通すことで、画面と同じ形のシートになる) */
function batchesOf(side: Side): Batch[] {
  const ops: Op[] = [{ kind: 'sheet.create', target: SHEET, name: 'S' }];
  const content: Op[] = [];
  side.nodes.forEach((spec, i) => {
    if (!spec) return;
    const target = NODES[i] as NodeId;
    content.push({ kind: 'node.add', target, content: spec.content });
    if (spec.label)
      content.push({ kind: 'node.setLabel', target, label: spec.label });
    if (spec.prop)
      content.push({
        kind: 'node.setProperty',
        target,
        name: 'owner',
        value: 'x',
      });
    content.push({ kind: 'node.setLayout', target, x: spec.x, y: 0 } as Op);
  });
  side.edges.forEach((spec, i) => {
    const [source, dest] = ENDS[i] as [NodeId, NodeId];
    // 端の node が在るときだけ edge を置く (端の無い edge は姿にならない)
    if (
      !spec ||
      !side.nodes[NODES.indexOf(source)] ||
      !side.nodes[NODES.indexOf(dest)]
    )
      return;
    const target = EDGES[i] as EdgeId;
    content.push({ kind: 'edge.add', target, source, dest });
    if (spec.label)
      content.push({ kind: 'edge.setLabel', target, label: spec.label });
  });
  return [
    {
      id: 'b1' as Batch['id'],
      actor: ACTOR,
      clock: 1,
      seq: 1,
      deps: {},
      timestamp: 1,
      ops,
    },
    {
      id: 'b2' as Batch['id'],
      actor: ACTOR,
      clock: 2,
      seq: 2,
      deps: {},
      timestamp: 2,
      ops: content,
      sheetId: SHEET,
    },
  ];
}
const sheetOf = (batches: Batch[]): Sheet =>
  projectFile(batches, FILE).sheets[0] as Sheet;

/** event の列を後に積んで projection する */
function apply(
  batches: Batch[],
  events: ReturnType<typeof alignToPane>,
): Sheet {
  const more = events.map((event, i) =>
    graphEventToBatch(event, {
      clock: 10 + i,
      seq: 10 + i,
      deps: {},
      actor: ACTOR,
      sheetId: SHEET,
    }),
  );
  return sheetOf([...batches, ...more]);
}

const nodeShape = (sheet: Sheet, id: string) => {
  const n = sheet.nodes.find((x) => x.id === id);
  if (!n) return null;
  const l = sheet.layouts?.find((x) => x.nodeId === id);
  return [n.content, n.label ?? '', n.properties ?? {}, l?.x ?? 0];
};
const edgeShape = (sheet: Sheet, id: string) => {
  const e = sheet.edges.find((x) => x.id === id);
  return e ? [e.source, e.target, e.label ?? ''] : null;
};

describe('alignToPane: 性質', () => {
  test('∀ merge 後の姿・pane の姿・選んだ要素. 揃えた後、選んだ要素は pane の姿と同じ (在否・本文・名前・プロパティ・位置)', () => {
    fc.assert(
      fc.property(
        arbSide,
        arbSide,
        fc.subarray([...NODES, ...EDGES] as string[], { minLength: 1 }),
        (resultSide, paneSide, ids) => {
          const resultBatches = batchesOf(resultSide);
          const pane = sheetOf(batchesOf(paneSide));
          const aligned = apply(
            resultBatches,
            alignToPane(sheetOf(resultBatches), pane, ids),
          );
          for (const id of ids) {
            if ((NODES as string[]).includes(id)) {
              expect(nodeShape(aligned, id)).toEqual(nodeShape(pane, id));
            } else if (edgeShape(pane, id)) {
              // pane に在る edge は、端の node ごと取り込まれて在る
              expect(edgeShape(aligned, id)).toEqual(edgeShape(pane, id));
            } else {
              expect(edgeShape(aligned, id)).toBeNull();
            }
          }
        },
      ),
    );
  });

  test('∀ 姿. 選ばなかった node は変わらない (取り込みは選んだ要素だけ)', () => {
    fc.assert(
      fc.property(
        arbSide,
        arbSide,
        fc.nat({ max: 2 }),
        (resultSide, paneSide, i) => {
          const resultBatches = batchesOf(resultSide);
          const result = sheetOf(resultBatches);
          const picked = NODES[i] as string;
          // edge を通じて巻き込まれない node (選んだ node と edge で繋がっていない node) だけを見る
          const aligned = apply(
            resultBatches,
            alignToPane(result, sheetOf(batchesOf(paneSide)), [picked]),
          );
          for (const other of NODES) {
            if (other === picked) continue;
            expect(nodeShape(aligned, other)).toEqual(nodeShape(result, other));
          }
        },
      ),
    );
  });
});

describe('alignToPane: 例', () => {
  test('同じなら何も出さない', () => {
    const side: Side = {
      nodes: [{ content: 'a', label: '', prop: false, x: 0 }, null, null],
      edges: [null, null],
    };
    const sheet = sheetOf(batchesOf(side));
    expect(alignToPane(sheet, sheet, [NODES[0] as string])).toEqual([]);
  });
});
