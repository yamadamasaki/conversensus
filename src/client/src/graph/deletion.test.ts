import { describe, expect, it } from 'bun:test';
import type { Edge, Node } from '@xyflow/react';
import { deletionTargets } from './deletion';

function node(id: string, parentId?: string, selected = false): Node {
  return {
    id,
    position: { x: 0, y: 0 },
    data: {},
    selected,
    ...(parentId ? { parentId } : {}),
  } as Node;
}

function edge(id: string, source: string, target: string, selected = false) {
  return { id, source, target, selected } as Edge;
}

// group > child > grandchild の入れ子と、外側の outsider
const group = node('group');
const child = node('child', 'group');
const grandchild = node('grandchild', 'child');
const outsider = node('outsider');
const nodes = [group, child, grandchild, outsider];

describe('deletionTargets', () => {
  it('何も選択されていなければ何も消さない', () => {
    expect(deletionTargets(nodes, [])).toEqual({ nodes: [], edges: [] });
  });

  it('グループを選ぶと子孫もまとめて対象になる', () => {
    const selected = [
      { ...group, selected: true },
      child,
      grandchild,
      outsider,
    ];

    expect(deletionTargets(selected, []).nodes.map((n) => n.id)).toEqual([
      'group',
      'child',
      'grandchild',
    ]);
  });

  it('子だけを選んだときは親を巻き込まない', () => {
    const selected = [
      group,
      { ...child, selected: true },
      grandchild,
      outsider,
    ];

    expect(deletionTargets(selected, []).nodes.map((n) => n.id)).toEqual([
      'child',
      'grandchild',
    ]);
  });

  it('消えるノードに繋がるエッジは選択されていなくても消える', () => {
    const selected = [
      { ...group, selected: true },
      child,
      grandchild,
      outsider,
    ];
    const edges = [
      edge('inside', 'grandchild', 'outsider'),
      edge('unrelated', 'outsider', 'outsider'),
    ];

    expect(deletionTargets(selected, edges).edges.map((e) => e.id)).toEqual([
      'inside',
    ]);
  });

  it('選択されたエッジは端点が残っていても消える', () => {
    const edges = [edge('selected', 'outsider', 'outsider', true)];

    expect(deletionTargets(nodes, edges).edges.map((e) => e.id)).toEqual([
      'selected',
    ]);
  });

  it('返す順序は引数の順序 (親が子より前) を保つ', () => {
    const selected = [
      { ...group, selected: true },
      child,
      grandchild,
      { ...outsider, selected: true },
    ];
    const result = deletionTargets(selected, []).nodes.map((n) => n.id);

    expect(result.indexOf('group')).toBeLessThan(result.indexOf('child'));
    expect(result.indexOf('child')).toBeLessThan(result.indexOf('grandchild'));
  });
});
