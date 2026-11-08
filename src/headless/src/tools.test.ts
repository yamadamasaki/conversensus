import { describe, expect, test } from 'bun:test';
import type { GraphEvent } from '@conversensus/client/src/events/GraphEvent';
import { graphEventToOps } from '@conversensus/client/src/events/toUnified';
import { DEFAULT_NODE_STYLE } from '@conversensus/client/src/nodeGeometry';
import {
  type NodeId,
  type Sheet,
  type Template,
  TemplateSchema,
} from '@conversensus/shared';
import fc from 'fast-check';
import {
  addEdge,
  addNode,
  autoPlace,
  moveNode,
  removeEdge,
  removeNode,
  setEdgeLabel,
  setEdgeProperty,
  setNodeContent,
  setNodeProperty,
  type ToolContext,
  ToolError,
} from './tools';

const SHEET = '11111111-1111-4111-8111-111111111111';
const CLAIM_NODE = '22222222-2222-4222-8222-222222222222';
const GROUND_NODE = '33333333-3333-4333-8333-333333333333';
const PLAIN_NODE = '44444444-4444-4444-8444-444444444444';
const GROUP_NODE = '55555555-5555-4555-8555-555555555555';
const PLAIN_EDGE = '66666666-6666-4666-8666-666666666666';
const KIND_EDGE = '77777777-7777-4777-8777-777777777777';
const MISSING = '88888888-8888-4888-8888-888888888888';

const TEMPLATE_ID = 'template.toulmin-sheet';
const KIND_PROPERTY = `${TEMPLATE_ID}.kind`;
const CLAIM = 'kind-claim';
const GROUND = 'kind-ground';
const SUPPORTS = 'kind-supports';
const REBUTS = 'kind-rebuts';

/** 主張・根拠と、根拠 → 主張の edge 種別 (`extraEdge` で 2 つ目を足すと候補が複数になる) */
function toulmin(extraEdge = false): Template {
  return TemplateSchema.parse({
    id: TEMPLATE_ID,
    name: 'toulmin',
    nodeKinds: [
      { id: CLAIM, label: '主張', defaults: { strength: 'normal' } },
      { id: GROUND, label: '根拠' },
    ],
    edgeKinds: [
      { id: SUPPORTS, label: '支える', from: [GROUND], to: [CLAIM] },
      ...(extraEdge
        ? [{ id: REBUTS, label: '反駁する', from: [GROUND], to: [CLAIM] }]
        : []),
    ],
  });
}

const sheet = {
  id: SHEET,
  name: '議論',
  nodes: [
    {
      id: CLAIM_NODE,
      content: '週休 3 日',
      label: '主張',
      properties: { [KIND_PROPERTY]: CLAIM },
    },
    {
      id: GROUND_NODE,
      content: '生産性',
      label: '根拠',
      properties: { [KIND_PROPERTY]: GROUND },
    },
    { id: PLAIN_NODE, content: 'メモ', properties: { priority: 'high' } },
    { id: GROUP_NODE, content: '束', nodeType: 'group' },
  ],
  edges: [
    { id: PLAIN_EDGE, source: PLAIN_NODE, target: CLAIM_NODE, label: '関係' },
    {
      id: KIND_EDGE,
      source: GROUND_NODE,
      target: CLAIM_NODE,
      label: '支える',
      properties: { [KIND_PROPERTY]: SUPPORTS },
    },
  ],
  layouts: [
    { nodeId: CLAIM_NODE, x: 0, y: 0, width: 160, height: 80 },
    { nodeId: GROUND_NODE, x: 200, y: 300, width: 160, height: 100 },
  ],
} as unknown as Sheet;

const ctx = (extraEdge = false): ToolContext => ({
  sheet,
  templates: [toulmin(extraEdge)],
});

/** 道具が出す op の種類 (道具 1 回 = GraphEvent 1 つ = batch 1 つ) */
const kinds = (event: GraphEvent) =>
  graphEventToOps(event).map((op) => op.kind);

describe('道具 → op (1 対 1)', () => {
  test('addNode は node.add と位置の node.setLayout', () => {
    const { event, nodeId } = addNode(ctx(), { content: 'x', x: 10, y: 20 });
    expect(kinds(event)).toEqual(['node.add', 'node.setLayout']);
    expect(graphEventToOps(event)[1]).toMatchObject({
      target: nodeId,
      x: 10,
      y: 20,
    });
  });

  test.each([
    [
      'setNodeContent',
      () => setNodeContent(ctx(), { nodeId: PLAIN_NODE, content: 'y' }),
      ['node.setContent'],
    ],
    [
      'setNodeProperty',
      () =>
        setNodeProperty(ctx(), {
          nodeId: PLAIN_NODE,
          name: 'due',
          value: '明日',
        }),
      ['node.setProperty'],
    ],
    [
      'moveNode',
      () => moveNode(ctx(), { nodeId: CLAIM_NODE, x: 5, y: 6 }),
      ['node.setLayout'],
    ],
    [
      'removeNode',
      () => removeNode(ctx(), { nodeId: PLAIN_NODE }),
      ['node.remove'],
    ],
    [
      'addEdge',
      () => addEdge(ctx(), { source: PLAIN_NODE, target: GROUP_NODE }).event,
      ['edge.add'],
    ],
    [
      'setEdgeLabel',
      () => setEdgeLabel(ctx(), { edgeId: PLAIN_EDGE, label: '新' }),
      ['edge.setLabel'],
    ],
    [
      'setEdgeProperty',
      () => setEdgeProperty(ctx(), { edgeId: PLAIN_EDGE, name: 'w', value: 1 }),
      ['edge.setProperty'],
    ],
    [
      'removeEdge',
      () => removeEdge(ctx(), { edgeId: PLAIN_EDGE }),
      ['edge.remove'],
    ],
  ] as const)('%s', (_, make, expected) => {
    expect(kinds(make())).toEqual([...expected]);
  });

  test('setNodeProperty は変えた 1 つだけを書き、他の property は触らない', () => {
    const ops = graphEventToOps(
      setNodeProperty(ctx(), {
        nodeId: PLAIN_NODE,
        name: 'due',
        value: '明日',
      }),
    );
    expect(ops).toEqual([
      {
        kind: 'node.setProperty',
        target: PLAIN_NODE as NodeId,
        name: 'due',
        value: '明日',
      },
    ]);
  });

  test('value を省くと property を消す', () => {
    const ops = graphEventToOps(
      setNodeProperty(ctx(), { nodeId: PLAIN_NODE, name: 'priority' }),
    );
    expect(ops).toEqual([
      {
        kind: 'node.setProperty',
        target: PLAIN_NODE as NodeId,
        name: 'priority',
      },
    ]);
  });
});

describe('種別', () => {
  test('種別を付けて node を足すと、label・種別プロパティ・種類の既定値が入る', () => {
    const { event } = addNode(ctx(), { content: '主張する', kind: CLAIM });
    expect(graphEventToOps(event)[0]).toMatchObject({
      kind: 'node.add',
      label: '主張',
      properties: { strength: 'normal', [KIND_PROPERTY]: CLAIM },
    });
  });

  test('知らない種別は断る', () => {
    expect(() =>
      addNode(ctx(), { content: 'x', kind: 'kind-unknown' }),
    ).toThrow(ToolError);
  });

  test('種別プロパティと system の property は書けない', () => {
    expect(() =>
      setNodeProperty(ctx(), {
        nodeId: CLAIM_NODE,
        name: KIND_PROPERTY,
        value: GROUND,
      }),
    ).toThrow(/種別/);
    expect(() =>
      setNodeProperty(ctx(), {
        nodeId: PLAIN_NODE,
        name: 'app.conversensus.image',
        value: 1,
      }),
    ).toThrow(/本体/);
    expect(() =>
      addNode(ctx(), { content: 'x', properties: { [KIND_PROPERTY]: CLAIM } }),
    ).toThrow(ToolError);
  });

  test('edge の種別の候補が 1 つなら自動で付く', () => {
    const { event } = addEdge(ctx(), {
      source: GROUND_NODE,
      target: CLAIM_NODE,
    });
    expect(graphEventToOps(event)[0]).toMatchObject({
      kind: 'edge.add',
      label: '支える',
      properties: { [KIND_PROPERTY]: SUPPORTS },
    });
  });

  test('候補が複数なら選ばせ、選べば付く', () => {
    expect(() =>
      addEdge(ctx(true), { source: GROUND_NODE, target: CLAIM_NODE }),
    ).toThrow(/選んで/);
    const { event } = addEdge(ctx(true), {
      source: GROUND_NODE,
      target: CLAIM_NODE,
      kind: REBUTS,
    });
    expect(graphEventToOps(event)[0]).toMatchObject({ label: '反駁する' });
  });

  test('同じ template の要素どうしで候補が無ければ繋げない', () => {
    expect(() =>
      addEdge(ctx(), { source: CLAIM_NODE, target: GROUND_NODE }),
    ).toThrow(/繋げない/);
  });

  test('種別の無い node どうしは自由に繋げ、label も付けられる', () => {
    const { event } = addEdge(ctx(), {
      source: PLAIN_NODE,
      target: GROUP_NODE,
      label: '参照',
    });
    expect(graphEventToOps(event)[0]).toMatchObject({ label: '参照' });
    expect(graphEventToOps(event)[0]).not.toHaveProperty('properties');
  });

  test('種別のある edge の label は変えられない', () => {
    expect(() =>
      setEdgeLabel(ctx(), { edgeId: KIND_EDGE, label: '別' }),
    ).toThrow(ToolError);
  });
});

describe('検め', () => {
  test('無い node・edge を指すと断る', () => {
    expect(() =>
      setNodeContent(ctx(), { nodeId: MISSING, content: 'x' }),
    ).toThrow(/無い/);
    expect(() => removeEdge(ctx(), { edgeId: MISSING })).toThrow(/無い/);
    expect(() =>
      addEdge(ctx(), { source: MISSING, target: CLAIM_NODE }),
    ).toThrow(/無い/);
  });

  test('group でない node の中には入れない', () => {
    expect(() =>
      addNode(ctx(), { content: 'x', parentId: PLAIN_NODE }),
    ).toThrow(/group/);
  });
});

describe('自動で置く', () => {
  test('位置を省くと、同じ親の一番下の node の下に置く', () => {
    expect(autoPlace(sheet, undefined)).toEqual({ x: 0, y: 300 + 100 + 40 });
  });

  test('空の group の中は枠の内側から始める', () => {
    const at = autoPlace(sheet, GROUP_NODE as NodeId);
    expect(at.x).toBeGreaterThan(0);
    expect(at.y).toBeGreaterThan(0);
  });

  test('性質: どんな兄弟の並びでも、自動の位置の箱は兄弟の箱と重ならない', () => {
    const box = fc.record({
      x: fc.integer({ min: -2000, max: 2000 }),
      y: fc.integer({ min: -2000, max: 2000 }),
      width: fc.integer({ min: 1, max: 400 }),
      height: fc.oneof(fc.integer({ min: 1, max: 400 }), fc.constant('auto')),
    });
    fc.assert(
      fc.property(fc.array(box, { maxLength: 6 }), (boxes) => {
        const ids = boxes.map(() => crypto.randomUUID());
        const s = {
          ...sheet,
          nodes: ids.map((id) => ({ id, content: '' })),
          layouts: boxes.map((b, i) => ({ nodeId: ids[i], ...b })),
        } as unknown as Sheet;
        const at = autoPlace(s, undefined);
        for (const b of boxes) {
          const h =
            typeof b.height === 'number' ? b.height : DEFAULT_NODE_STYLE.height;
          // 縦に離れていれば重ならない (自動の位置は全員より下に置く)
          expect(
            at.y >= b.y + h || at.y + DEFAULT_NODE_STYLE.height <= b.y,
          ).toBe(true);
        }
      }),
    );
  });
});
