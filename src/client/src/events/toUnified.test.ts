import { describe, expect, test } from 'bun:test';
import {
  type EdgeId,
  EdgeIdSchema,
  type NodeId,
  NodeIdSchema,
  projectBatches,
  type SheetId,
  SheetIdSchema,
} from '@conversensus/shared';
import type { GraphEvent } from './GraphEvent';
import { makeEventBase } from './GraphEvent';
import { graphEventToBatch, graphEventToOps } from './toUnified';

const nid = (): NodeId => NodeIdSchema.parse(crypto.randomUUID());
const eid = (): EdgeId => EdgeIdSchema.parse(crypto.randomUUID());

describe('graphEventToOps: 複合イベントの分解', () => {
  test('NODES_GROUPED → group 追加 + layout + 子ごとの setParent/setLayout', () => {
    const parentId = nid();
    const childA = nid();
    const childB = nid();
    const event: GraphEvent = {
      ...makeEventBase('structure'),
      type: 'NODES_GROUPED',
      parentId,
      parentData: { id: parentId, content: '', nodeType: 'group' },
      parentLayout: { nodeId: parentId, x: 0, y: 0, width: 200, height: 200 },
      children: [
        {
          nodeId: childA,
          originalParentId: undefined,
          originalPosition: { x: 5, y: 5 },
          newPosition: { x: 10, y: 10 },
        },
        {
          nodeId: childB,
          originalParentId: undefined,
          originalPosition: { x: 6, y: 6 },
          newPosition: { x: 20, y: 20 },
        },
      ],
    };
    const ops = graphEventToOps(event);
    expect(ops[0]).toMatchObject({
      kind: 'node.add',
      target: parentId,
      nodeType: 'group',
    });
    expect(ops.filter((o) => o.kind === 'node.setParent')).toHaveLength(2);
    // 子を先に追加した状態でグループ化を畳み込むと親子関係が復元される
    const seed: GraphEvent = {
      ...makeEventBase('structure'),
      type: 'NODES_PASTED',
      nodes: [
        { id: childA, content: 'a' },
        { id: childB, content: 'b' },
      ],
      layouts: [],
      edges: [],
      edgeLayouts: [],
    };
    const g = projectBatches([
      graphEventToBatch(seed, 1),
      graphEventToBatch(event, 2),
    ]);
    expect(g.nodes.get(parentId)?.nodeType).toBe('group');
    expect(g.nodes.get(childA)?.parentId).toBe(parentId);
  });

  test('NODE_REPARENTED → setParent + setLayout の 2 op', () => {
    const nodeId = nid();
    const newParent = nid();
    const event: GraphEvent = {
      ...makeEventBase('structure'),
      type: 'NODE_REPARENTED',
      nodeId,
      oldParentId: undefined,
      newParentId: newParent,
      oldPosition: { x: 0, y: 0 },
      newPosition: { x: 50, y: 60 },
    };
    const ops = graphEventToOps(event);
    expect(ops.map((o) => o.kind)).toEqual([
      'node.setParent',
      'node.setLayout',
    ]);
  });
});

describe('graphEventToOps: 全 19 イベント型を網羅する', () => {
  // 各型の最小構成インスタンス。新しい型を追加したらここに足す (網羅性の番人)
  const nodeId = nid();
  const edgeId = eid();
  const events: GraphEvent[] = [
    {
      ...makeEventBase('structure'),
      type: 'NODE_ADDED',
      nodeId,
      data: { id: nodeId, content: 'A' },
      layout: { nodeId, x: 0, y: 0 },
    },
    {
      ...makeEventBase('structure'),
      type: 'NODE_DELETED',
      nodeId,
      data: { id: nodeId, content: 'A' },
    },
    {
      ...makeEventBase('structure'),
      type: 'EDGE_ADDED',
      edgeId,
      data: { id: edgeId, source: nid(), target: nid() },
    },
    {
      ...makeEventBase('structure'),
      type: 'EDGE_DELETED',
      edgeId,
      data: { id: edgeId, source: nid(), target: nid() },
    },
    {
      ...makeEventBase('structure'),
      type: 'EDGE_RECONNECTED',
      edgeId,
      from: { source: nid(), target: nid() },
      to: { source: nid(), target: nid() },
    },
    {
      ...makeEventBase('structure'),
      type: 'NODE_REPARENTED',
      nodeId,
      oldParentId: undefined,
      newParentId: nid(),
      oldPosition: { x: 0, y: 0 },
      newPosition: { x: 1, y: 1 },
    },
    {
      ...makeEventBase('structure'),
      type: 'NODES_GROUPED',
      parentId: nodeId,
      parentData: { id: nodeId, content: '' },
      parentLayout: { nodeId },
      children: [],
    },
    {
      ...makeEventBase('structure'),
      type: 'NODES_UNGROUPED',
      parentId: nodeId,
      parentData: { id: nodeId, content: '' },
      parentLayout: { nodeId },
      children: [
        {
          nodeId: nid(),
          originalParentId: undefined,
          originalPosition: { x: 0, y: 0 },
          newPosition: { x: 0, y: 0 },
        },
      ],
    },
    {
      ...makeEventBase('structure'),
      type: 'NODES_PASTED',
      nodes: [{ id: nid(), content: 'P' }],
      layouts: [],
      edges: [],
      edgeLayouts: [],
    },
    {
      ...makeEventBase('structure'),
      type: 'NODES_PASTED_UNDO',
      nodeIds: [nid()],
      edgeIds: [eid()],
      nodes: [],
      layouts: [],
      edges: [],
      edgeLayouts: [],
    },
    {
      ...makeEventBase('content'),
      type: 'NODE_RELABELED',
      nodeId,
      from: 'a',
      to: 'b',
    },
    {
      ...makeEventBase('content'),
      type: 'EDGE_RELABELED',
      edgeId,
      from: 'a',
      to: 'b',
    },
    {
      ...makeEventBase('content'),
      type: 'NODE_PROPERTIES_CHANGED',
      nodeId,
      from: {},
      to: { k: 1 },
    },
    {
      ...makeEventBase('content'),
      type: 'EDGE_PROPERTIES_CHANGED',
      edgeId,
      from: {},
      to: { k: 1 },
    },
    {
      ...makeEventBase('layout'),
      type: 'NODE_MOVED',
      nodeId,
      from: { x: 0, y: 0 },
      to: { x: 1, y: 1 },
    },
    {
      ...makeEventBase('layout'),
      type: 'NODE_RESIZED',
      nodeId,
      from: { width: 1, height: 1 },
      to: { width: 2, height: 2 },
    },
    {
      ...makeEventBase('presentation'),
      type: 'EDGE_STYLE_CHANGED',
      edgeId,
      from: {},
      to: { stroke: 'red' },
    },
    {
      ...makeEventBase('presentation'),
      type: 'NODE_STYLE_CHANGED',
      nodeId,
      from: { nodeId },
      to: { nodeId, width: 10, height: 10 },
    },
    {
      ...makeEventBase('presentation'),
      type: 'EDGE_LABEL_MOVED',
      edgeId,
      from: { offsetX: 0, offsetY: 0 },
      to: { offsetX: 5, offsetY: 5 },
    },
  ];

  test('19 型すべてを用意している', () => {
    const types = new Set(events.map((e) => e.type));
    expect(types.size).toBe(19);
  });

  test('各イベントが 1 つ以上の op に分解される', () => {
    for (const event of events) {
      expect(graphEventToOps(event).length).toBeGreaterThanOrEqual(1);
    }
  });

  test('graphEventToBatch は event.id を BatchId に、userId を actor にする', () => {
    const event = events[0];
    const batch = graphEventToBatch(event, 7);
    expect(batch.id).toBe(event.id);
    expect(batch.actor).toBe(event.userId);
    expect(batch.clock).toBe(7);
  });
});

describe('graphEventToOps: file 構造イベント (W3c1)', () => {
  const sid = (): SheetId => SheetIdSchema.parse(crypto.randomUUID());

  test('SHEET_CREATED → sheet.create (description 付き)', () => {
    const sheetId = sid();
    const ops = graphEventToOps({
      ...makeEventBase('file'),
      type: 'SHEET_CREATED',
      sheetId,
      name: 'S1',
      description: 'desc',
    });
    expect(ops).toEqual([
      {
        kind: 'sheet.create',
        target: sheetId,
        name: 'S1',
        description: 'desc',
      },
    ]);
  });

  test('SHEET_REMOVED → sheet.remove', () => {
    const sheetId = sid();
    expect(
      graphEventToOps({
        ...makeEventBase('file'),
        type: 'SHEET_REMOVED',
        sheetId,
      }),
    ).toEqual([{ kind: 'sheet.remove', target: sheetId }]);
  });

  test('SHEET_RENAMED / SHEET_DESCRIBED → sheet.setName / sheet.setDescription', () => {
    const sheetId = sid();
    expect(
      graphEventToOps({
        ...makeEventBase('file'),
        type: 'SHEET_RENAMED',
        sheetId,
        name: 'new',
      }),
    ).toEqual([{ kind: 'sheet.setName', target: sheetId, name: 'new' }]);
    // description 未指定 (クリア) は description フィールドを持たない op
    expect(
      graphEventToOps({
        ...makeEventBase('file'),
        type: 'SHEET_DESCRIBED',
        sheetId,
      }),
    ).toEqual([{ kind: 'sheet.setDescription', target: sheetId }]);
  });

  test('FILE_RENAMED / FILE_DESCRIBED → file.setName / file.setDescription', () => {
    expect(
      graphEventToOps({
        ...makeEventBase('file'),
        type: 'FILE_RENAMED',
        name: 'F',
      }),
    ).toEqual([{ kind: 'file.setName', name: 'F' }]);
    expect(
      graphEventToOps({
        ...makeEventBase('file'),
        type: 'FILE_DESCRIBED',
        description: 'd',
      }),
    ).toEqual([{ kind: 'file.setDescription', description: 'd' }]);
  });

  test('構造イベントは file 構造 batch (sheetId 無し) になる', () => {
    const batch = graphEventToBatch(
      { ...makeEventBase('file'), type: 'FILE_RENAMED', name: 'F' },
      3,
    );
    expect(batch.sheetId).toBeUndefined();
    expect(batch.ops).toEqual([{ kind: 'file.setName', name: 'F' }]);
  });
});
