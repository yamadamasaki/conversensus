import { describe, expect, it } from 'bun:test';
import type {
  EdgeId,
  GraphEdge,
  GraphNode,
  NodeId,
} from '@conversensus/shared';
import type { Edge, Node } from '@xyflow/react';
import {
  fromFlowEdges,
  fromFlowNodes,
  toFlowEdges,
  toFlowNodes,
} from './graphTransform';

const graphNodes: GraphNode[] = [
  { id: 'n1' as NodeId, content: 'ノード1', position: { x: 10, y: 20 } },
  {
    id: 'n2' as NodeId,
    content: 'ノード2',
    position: { x: 100, y: 200 },
    style: { color: 'red' },
  },
];

const graphEdges: GraphEdge[] = [
  {
    id: 'e1' as EdgeId,
    source: 'n1' as NodeId,
    target: 'n2' as NodeId,
    label: 'ラベル',
  },
  { id: 'e2' as EdgeId, source: 'n2' as NodeId, target: 'n1' as NodeId },
];

describe('toFlowNodes', () => {
  it('GraphNode を React Flow の Node に変換する', () => {
    const result = toFlowNodes(graphNodes);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: 'n1',
      position: { x: 10, y: 20 },
      data: { label: 'ノード1' },
    });
    expect(result[1]).toMatchObject({
      id: 'n2',
      position: { x: 100, y: 200 },
      data: { label: 'ノード2' },
    });
  });

  it('空配列は空配列を返す', () => {
    expect(toFlowNodes([])).toEqual([]);
  });
});

describe('toFlowEdges', () => {
  it('GraphEdge を React Flow の Edge に変換する', () => {
    const result = toFlowEdges(graphEdges);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: 'e1',
      source: 'n1',
      target: 'n2',
      label: 'ラベル',
    });
    expect(result[1]).toMatchObject({ id: 'e2', source: 'n2', target: 'n1' });
  });

  it('空配列は空配列を返す', () => {
    expect(toFlowEdges([])).toEqual([]);
  });
});

describe('fromFlowNodes', () => {
  it('React Flow の Node を GraphNode に変換する', () => {
    const flowNodes: Node[] = [
      {
        id: 'n1',
        position: { x: 10, y: 20 },
        data: { label: 'ノード1' },
        type: 'default',
      },
    ];
    const result = fromFlowNodes(flowNodes);
    expect(result[0]).toMatchObject({
      id: 'n1',
      content: 'ノード1',
      position: { x: 10, y: 20 },
    });
  });

  it('label が undefined のとき content は空文字になる', () => {
    const flowNodes: Node[] = [
      { id: 'n1', position: { x: 0, y: 0 }, data: {}, type: 'default' },
    ];
    const result = fromFlowNodes(flowNodes);
    expect(result[0].content).toBe('');
  });

  it('空配列は空配列を返す', () => {
    expect(fromFlowNodes([])).toEqual([]);
  });
});

describe('fromFlowEdges', () => {
  it('React Flow の Edge を GraphEdge に変換する', () => {
    const flowEdges: Edge[] = [
      { id: 'e1', source: 'n1', target: 'n2', label: 'ラベル' },
    ];
    const result = fromFlowEdges(flowEdges);
    expect(result[0]).toMatchObject({
      id: 'e1',
      source: 'n1',
      target: 'n2',
      label: 'ラベル',
    });
  });

  it('label が string でない場合は undefined になる', () => {
    const flowEdges: Edge[] = [
      { id: 'e1', source: 'n1', target: 'n2', label: 42 as unknown as string },
    ];
    const result = fromFlowEdges(flowEdges);
    expect(result[0].label).toBeUndefined();
  });

  it('label がない Edge は label が undefined になる', () => {
    const flowEdges: Edge[] = [{ id: 'e2', source: 'n2', target: 'n1' }];
    const result = fromFlowEdges(flowEdges);
    expect(result[0].label).toBeUndefined();
  });

  it('空配列は空配列を返す', () => {
    expect(fromFlowEdges([])).toEqual([]);
  });
});

describe('toFlowNodes → fromFlowNodes の対称性', () => {
  it('変換して戻すと元のデータが復元される', () => {
    const result = fromFlowNodes(toFlowNodes(graphNodes));
    expect(result[0]).toMatchObject({
      id: 'n1',
      content: 'ノード1',
      position: { x: 10, y: 20 },
    });
    expect(result[1]).toMatchObject({
      id: 'n2',
      content: 'ノード2',
      position: { x: 100, y: 200 },
    });
  });
});

describe('toFlowEdges → fromFlowEdges の対称性', () => {
  it('label ありの Edge は変換して戻すと復元される', () => {
    const result = fromFlowEdges(toFlowEdges(graphEdges));
    expect(result[0]).toMatchObject({
      id: 'e1',
      source: 'n1',
      target: 'n2',
      label: 'ラベル',
    });
  });
});
