import { describe, expect, it } from 'bun:test';
import type {
  EdgeId,
  EdgeLayout,
  GraphEdge,
  GraphNode,
  NodeId,
  NodeLayout,
  Sheet,
  SheetId,
} from '@conversensus/shared';
import { DEFAULT_EDGE_PATH_TYPE, DEFAULT_NODE_STYLE } from '../graphTransform';
import {
  computeOperations,
  computeSheetChanges,
  isLayoutOnly,
} from './computeOperations';

const sid = '00000000-0000-0000-0000-000000000001' as SheetId;

function emptySheet(): Sheet {
  return { id: sid, name: 'test', nodes: [], edges: [] };
}

function n(id: string, content = 'content'): GraphNode {
  return { id: id as NodeId, content };
}

function nWithProps(
  id: string,
  content: string,
  props: Record<string, unknown>,
): GraphNode {
  return { id: id as NodeId, content, properties: props };
}

function e(
  id: string,
  source: string,
  target: string,
  label?: string,
): GraphEdge {
  return {
    id: id as EdgeId,
    source: source as NodeId,
    target: target as NodeId,
    ...(label && { label }),
  };
}

function eWithProps(
  id: string,
  source: string,
  target: string,
  props: Record<string, unknown>,
): GraphEdge {
  return {
    id: id as EdgeId,
    source: source as NodeId,
    target: target as NodeId,
    properties: props,
  };
}

// --- node.add ---

describe('computeOperations: node.add', () => {
  it('base になく current にあるノードは node.add', () => {
    const ops = computeOperations(emptySheet(), {
      id: sid,
      name: 'test',
      nodes: [n('n1')],
      edges: [],
    });
    expect(ops).toEqual([{ op: 'node.add', nodeId: 'n1', content: 'content' }]);
  });

  it('properties があるノードの追加', () => {
    const ops = computeOperations(emptySheet(), {
      id: sid,
      name: 'test',
      nodes: [nWithProps('n1', 'c', { key: 'v' })],
      edges: [],
    });
    expect(ops).toEqual([
      { op: 'node.add', nodeId: 'n1', content: 'c', properties: { key: 'v' } },
    ]);
  });
});

// --- node.update ---

describe('computeOperations: node.update', () => {
  it('content が変わると node.update', () => {
    const base: Sheet = {
      id: sid,
      name: 'test',
      nodes: [n('n1', 'old')],
      edges: [],
    };
    const ops = computeOperations(base, { ...base, nodes: [n('n1', 'new')] });
    expect(ops).toEqual([{ op: 'node.update', nodeId: 'n1', content: 'new' }]);
  });

  it('properties が変わると node.update', () => {
    const base: Sheet = {
      id: sid,
      name: 'test',
      nodes: [nWithProps('n1', 'c', { a: 1 })],
      edges: [],
    };
    const ops = computeOperations(base, {
      ...base,
      nodes: [nWithProps('n1', 'c', { a: 2 })],
    });
    expect(ops).toEqual([
      { op: 'node.update', nodeId: 'n1', content: 'c', properties: { a: 2 } },
    ]);
  });

  it('properties が追加された場合も node.update', () => {
    const base: Sheet = {
      id: sid,
      name: 'test',
      nodes: [n('n1', 'c')],
      edges: [],
    };
    const ops = computeOperations(base, {
      ...base,
      nodes: [nWithProps('n1', 'c', { new: true })],
    });
    expect(ops).toEqual([
      {
        op: 'node.update',
        nodeId: 'n1',
        content: 'c',
        properties: { new: true },
      },
    ]);
  });

  it('content も properties も同じなら ops は空', () => {
    const base: Sheet = {
      id: sid,
      name: 'test',
      nodes: [nWithProps('n1', 'c', { a: 1 })],
      edges: [],
    };
    const ops = computeOperations(base, {
      ...base,
      nodes: [nWithProps('n1', 'c', { a: 1 })],
    });
    expect(ops).toEqual([]);
  });
});

// --- node.remove ---

describe('computeOperations: node.remove', () => {
  it('current にないノードは node.remove', () => {
    const base: Sheet = { id: sid, name: 'test', nodes: [n('n1')], edges: [] };
    const ops = computeOperations(base, emptySheet());
    expect(ops).toEqual([{ op: 'node.remove', nodeId: 'n1' }]);
  });
});

// --- edge.add ---

describe('computeOperations: edge.add', () => {
  it('base になく current にあるエッジは edge.add', () => {
    const ops = computeOperations(emptySheet(), {
      id: sid,
      name: 'test',
      nodes: [],
      edges: [e('e1', 'n1', 'n2', 'label')],
    });
    expect(ops).toEqual([
      {
        op: 'edge.add',
        edgeId: 'e1',
        sourceId: 'n1',
        targetId: 'n2',
        label: 'label',
      },
    ]);
  });

  it('label なしのエッジ追加', () => {
    const ops = computeOperations(emptySheet(), {
      id: sid,
      name: 'test',
      nodes: [],
      edges: [e('e1', 'n1', 'n2')],
    });
    expect(ops).toEqual([
      { op: 'edge.add', edgeId: 'e1', sourceId: 'n1', targetId: 'n2' },
    ]);
  });
});

// --- edge.update ---

describe('computeOperations: edge.update', () => {
  it('label が変わると edge.update', () => {
    const base: Sheet = {
      id: sid,
      name: 'test',
      nodes: [],
      edges: [e('e1', 'n1', 'n2', 'old')],
    };
    const ops = computeOperations(base, {
      ...base,
      edges: [e('e1', 'n1', 'n2', 'new')],
    });
    expect(ops).toEqual([{ op: 'edge.update', edgeId: 'e1', label: 'new' }]);
  });

  it('label が undefined に変わったとき edge.update の label が undefined', () => {
    const base: Sheet = {
      id: sid,
      name: 'test',
      nodes: [],
      edges: [e('e1', 'n1', 'n2', 'old')],
    };
    const ops = computeOperations(base, {
      ...base,
      edges: [e('e1', 'n1', 'n2')],
    });
    expect(ops).toHaveLength(1);
    expect(ops[0].op).toBe('edge.update');
  });

  it('properties が変わると edge.update', () => {
    const base: Sheet = {
      id: sid,
      name: 'test',
      nodes: [],
      edges: [eWithProps('e1', 'n1', 'n2', { a: 1 })],
    };
    const ops = computeOperations(base, {
      ...base,
      edges: [eWithProps('e1', 'n1', 'n2', { a: 2 })],
    });
    expect(ops).toEqual([
      { op: 'edge.update', edgeId: 'e1', properties: { a: 2 } },
    ]);
  });
});

// --- edge.remove ---

describe('computeOperations: edge.remove', () => {
  it('current にないエッジは edge.remove', () => {
    const base: Sheet = {
      id: sid,
      name: 'test',
      nodes: [],
      edges: [e('e1', 'n1', 'n2')],
    };
    const ops = computeOperations(base, emptySheet());
    expect(ops).toEqual([{ op: 'edge.remove', edgeId: 'e1' }]);
  });
});

// --- 同一シート ---

describe('computeOperations: 同一シート', () => {
  it('base と current が同一なら ops は空', () => {
    const sheet: Sheet = {
      id: sid,
      name: 'test',
      nodes: [n('n1'), n('n2')],
      edges: [e('e1', 'n1', 'n2', 'rel')],
    };
    expect(computeOperations(sheet, sheet)).toEqual([]);
  });
});

// --- layout の変更 (ANA-124) ---

describe('computeSheetChanges: layout も差分に出る', () => {
  const nodeSheet = (layouts?: NodeLayout[]): Sheet => ({
    id: sid,
    name: 'test',
    nodes: [n('n1')],
    edges: [],
    ...(layouts && { layouts }),
  });

  it('ノードを動かしただけで node.update が出る', () => {
    const changes = computeSheetChanges(
      nodeSheet([{ nodeId: 'n1' as NodeId, x: 0, y: 0 }]),
      nodeSheet([{ nodeId: 'n1' as NodeId, x: 100, y: 200 }]),
    );
    expect(changes).toHaveLength(1);
    expect(changes[0].op).toMatchObject({ op: 'node.update', nodeId: 'n1' });
  });

  it('layout だけの変更は categories が layout のみになる', () => {
    const changes = computeSheetChanges(
      nodeSheet([{ nodeId: 'n1' as NodeId, x: 0, y: 0 }]),
      nodeSheet([{ nodeId: 'n1' as NodeId, x: 100, y: 200 }]),
    );
    expect(changes[0].categories).toEqual(['layout']);
    expect(isLayoutOnly(changes[0])).toBe(true);
  });

  it('意味と layout が同時に変わると categories に両方入る', () => {
    const base: Sheet = {
      id: sid,
      name: 'test',
      nodes: [n('n1', 'old')],
      edges: [],
      layouts: [{ nodeId: 'n1' as NodeId, x: 0, y: 0 }],
    };
    const current: Sheet = {
      id: sid,
      name: 'test',
      nodes: [n('n1', 'new')],
      edges: [],
      layouts: [{ nodeId: 'n1' as NodeId, x: 100, y: 0 }],
    };
    const changes = computeSheetChanges(base, current);
    expect(changes[0].categories).toEqual(['content', 'layout']);
    expect(isLayoutOnly(changes[0])).toBe(false);
  });

  it('リサイズ (width/height) も差分に出る', () => {
    const changes = computeSheetChanges(
      nodeSheet([{ nodeId: 'n1' as NodeId, x: 0, y: 0, width: 160 }]),
      nodeSheet([{ nodeId: 'n1' as NodeId, x: 0, y: 0, width: 300 }]),
    );
    expect(changes).toHaveLength(1);
    expect(changes[0].categories).toEqual(['layout']);
  });

  it('エッジの経路 (pathType) の変更も差分に出る', () => {
    const edgeSheet = (edgeLayouts?: EdgeLayout[]): Sheet => ({
      id: sid,
      name: 'test',
      nodes: [],
      edges: [e('e1', 'n1', 'n2')],
      ...(edgeLayouts && { edgeLayouts }),
    });
    const changes = computeSheetChanges(
      edgeSheet([{ edgeId: 'e1' as EdgeId, pathType: 'bezier' }]),
      edgeSheet([{ edgeId: 'e1' as EdgeId, pathType: 'step' }]),
    );
    expect(changes).toHaveLength(1);
    expect(changes[0].op).toMatchObject({ op: 'edge.update', edgeId: 'e1' });
    expect(changes[0].categories).toEqual(['layout']);
  });
});

// --- 正規化: 「省略」と「既定値の明示」を同じとみなす ---

describe('computeSheetChanges: 正規化', () => {
  it('layout の省略と既定値の明示は同じ (往復で入る既定値を差分にしない)', () => {
    // projection 側は layout を持たず、React Flow を往復した側は x=0 / 既定サイズが入る
    const base: Sheet = { id: sid, name: 'test', nodes: [n('n1')], edges: [] };
    const current: Sheet = {
      id: sid,
      name: 'test',
      nodes: [n('n1')],
      edges: [],
      layouts: [
        {
          nodeId: 'n1' as NodeId,
          x: 0,
          y: 0,
          width: DEFAULT_NODE_STYLE.width,
          height: DEFAULT_NODE_STYLE.height,
        },
      ],
    };
    expect(computeSheetChanges(base, current)).toEqual([]);
  });

  it('pathType の省略と既定値の明示は同じ', () => {
    const base: Sheet = {
      id: sid,
      name: 'test',
      nodes: [],
      edges: [e('e1', 'n1', 'n2')],
    };
    const current: Sheet = {
      id: sid,
      name: 'test',
      nodes: [],
      edges: [e('e1', 'n1', 'n2')],
      edgeLayouts: [
        { edgeId: 'e1' as EdgeId, pathType: DEFAULT_EDGE_PATH_TYPE },
      ],
    };
    expect(computeSheetChanges(base, current)).toEqual([]);
  });

  it('丸めで消える差 (1px 未満) は差分にしない', () => {
    // op-log は整数へ丸めて記録するので、丸めた後に同じ値なら op としては変化が無い
    const base: Sheet = {
      id: sid,
      name: 'test',
      nodes: [n('n1')],
      edges: [],
      layouts: [{ nodeId: 'n1' as NodeId, x: 100, y: 200 }],
    };
    const current: Sheet = {
      id: sid,
      name: 'test',
      nodes: [n('n1')],
      edges: [],
      layouts: [{ nodeId: 'n1' as NodeId, x: 100.4, y: 199.7 }],
    };
    expect(computeSheetChanges(base, current)).toEqual([]);
  });

  it('presentation (ラベル位置) は差分にしない', () => {
    // edge.setLabelOffset は presentation カテゴリ = ローカル限定でバージョン管理外
    const base: Sheet = {
      id: sid,
      name: 'test',
      nodes: [],
      edges: [e('e1', 'n1', 'n2')],
      edgeLayouts: [{ edgeId: 'e1' as EdgeId }],
    };
    const current: Sheet = {
      id: sid,
      name: 'test',
      nodes: [],
      edges: [e('e1', 'n1', 'n2')],
      edgeLayouts: [
        { edgeId: 'e1' as EdgeId, labelOffsetX: 40, labelOffsetY: -12 },
      ],
    };
    expect(computeSheetChanges(base, current)).toEqual([]);
  });

  it('properties の undefined と {} は同じ', () => {
    const base: Sheet = { id: sid, name: 'test', nodes: [n('n1')], edges: [] };
    const current: Sheet = {
      id: sid,
      name: 'test',
      nodes: [nWithProps('n1', 'content', {})],
      edges: [],
    };
    expect(computeSheetChanges(base, current)).toEqual([]);
  });

  it('properties はキーの順序に左右されない', () => {
    const base: Sheet = {
      id: sid,
      name: 'test',
      nodes: [nWithProps('n1', 'content', { a: 1, b: 2 })],
      edges: [],
    };
    const current: Sheet = {
      id: sid,
      name: 'test',
      nodes: [nWithProps('n1', 'content', { b: 2, a: 1 })],
      edges: [],
    };
    expect(computeSheetChanges(base, current)).toEqual([]);
  });
});

// --- net 比較: 同じ値に戻した編集は差分に出ない (ANA-119 §8-1) ---

describe('computeSheetChanges: 同じ値に戻した編集', () => {
  it('内容を編集して元に戻すと差分に出ない (undo を含む)', () => {
    // op-log には 2 件の op が積まれているが、基準との net の差は無い
    const sheet: Sheet = {
      id: sid,
      name: 'test',
      nodes: [n('n1', 'original')],
      edges: [],
    };
    expect(computeSheetChanges(sheet, structuredClone(sheet))).toEqual([]);
  });

  it('動かして元の位置に戻すと差分に出ない', () => {
    const layouts = [{ nodeId: 'n1' as NodeId, x: 10, y: 20 }];
    const base: Sheet = {
      id: sid,
      name: 'test',
      nodes: [n('n1')],
      edges: [],
      layouts,
    };
    const current: Sheet = {
      id: sid,
      name: 'test',
      nodes: [n('n1')],
      edges: [],
      layouts: structuredClone(layouts),
    };
    expect(computeSheetChanges(base, current)).toEqual([]);
  });

  it('同じノードを何度動かしても差分は 1 個に集約される', () => {
    // 中間の位置は基準にも現在にも残らないので、しきい値を設けなくても 1 個になる
    const base: Sheet = {
      id: sid,
      name: 'test',
      nodes: [n('n1')],
      edges: [],
      layouts: [{ nodeId: 'n1' as NodeId, x: 0, y: 0 }],
    };
    const current: Sheet = {
      id: sid,
      name: 'test',
      nodes: [n('n1')],
      edges: [],
      layouts: [{ nodeId: 'n1' as NodeId, x: 500, y: 500 }],
    };
    expect(computeSheetChanges(base, current)).toHaveLength(1);
  });
});

// --- エッジの付け替え (structure) ---

describe('computeSheetChanges: エッジの付け替え', () => {
  it('source / target が変わると edge.update が出る', () => {
    const base: Sheet = {
      id: sid,
      name: 'test',
      nodes: [],
      edges: [e('e1', 'n1', 'n2')],
    };
    const current: Sheet = {
      id: sid,
      name: 'test',
      nodes: [],
      edges: [e('e1', 'n1', 'n3')],
    };
    const changes = computeSheetChanges(base, current);
    expect(changes).toHaveLength(1);
    expect(changes[0].op).toMatchObject({ op: 'edge.update', edgeId: 'e1' });
    expect(changes[0].categories).toEqual(['structure']);
  });
});

// --- 複合操作 ---

describe('computeOperations: 複合操作', () => {
  it('追加・更新・削除の混在', () => {
    const base: Sheet = {
      id: sid,
      name: 'test',
      nodes: [n('n1', 'old'), n('n2')], // n1 更新, n2 削除
      edges: [e('e1', 'n1', 'n2')], // e1 削除
    };
    const current: Sheet = {
      id: sid,
      name: 'test',
      nodes: [n('n1', 'new'), n('n3')], // n1 更新, n3 追加
      edges: [e('e2', 'n1', 'n3', 'new-edge')], // e2 追加
    };
    const ops = computeOperations(base, current);
    expect(ops).toHaveLength(5);
    expect(ops).toContainEqual({
      op: 'node.update',
      nodeId: 'n1',
      content: 'new',
    });
    expect(ops).toContainEqual({
      op: 'node.add',
      nodeId: 'n3',
      content: 'content',
    });
    expect(ops).toContainEqual({ op: 'node.remove', nodeId: 'n2' });
    expect(ops).toContainEqual({
      op: 'edge.add',
      edgeId: 'e2',
      sourceId: 'n1',
      targetId: 'n3',
      label: 'new-edge',
    });
    expect(ops).toContainEqual({ op: 'edge.remove', edgeId: 'e1' });
  });
});

// --- エッジケース ---

describe('computeOperations: エッジケース', () => {
  it('空シート同士 → ops は空', () => {
    expect(computeOperations(emptySheet(), emptySheet())).toEqual([]);
  });

  it('空シートからのノード追加', () => {
    const ops = computeOperations(emptySheet(), {
      id: sid,
      name: 'test',
      nodes: [n('n1'), n('n2')],
      edges: [],
    });
    expect(ops).toHaveLength(2);
    expect(ops).toContainEqual({
      op: 'node.add',
      nodeId: 'n1',
      content: 'content',
    });
    expect(ops).toContainEqual({
      op: 'node.add',
      nodeId: 'n2',
      content: 'content',
    });
  });

  it('全ノード・全エッジ削除', () => {
    const base: Sheet = {
      id: sid,
      name: 'test',
      nodes: [n('n1'), n('n2')],
      edges: [e('e1', 'n1', 'n2')],
    };
    const ops = computeOperations(base, emptySheet());
    expect(ops).toHaveLength(3);
    expect(ops).toContainEqual({ op: 'node.remove', nodeId: 'n1' });
    expect(ops).toContainEqual({ op: 'node.remove', nodeId: 'n2' });
    expect(ops).toContainEqual({ op: 'edge.remove', edgeId: 'e1' });
  });

  it('ノード追加・エッジ追加の順序', () => {
    const ops = computeOperations(emptySheet(), {
      id: sid,
      name: 'test',
      nodes: [n('n1'), n('n2')],
      edges: [e('e1', 'n1', 'n2')],
    });
    // node.add が先、edge.add が後
    const nodeAddIndex = ops.findIndex((o) => o.op === 'node.add');
    const edgeAddIndex = ops.findIndex((o) => o.op === 'edge.add');
    expect(nodeAddIndex).toBeLessThan(edgeAddIndex);
  });
});
