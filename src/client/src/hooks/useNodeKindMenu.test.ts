import { describe, expect, it } from 'bun:test';
import { nodeKindsOf, TOULMIN_TEMPLATE } from '@conversensus/shared';
import { act, renderHook } from '@testing-library/react';
import type { Node } from '@xyflow/react';
import type { MouseEvent } from 'react';
import type { GraphEvent } from '../events/GraphEvent';
import { useNodeKindMenu } from './useNodeKindMenu';

const KINDS = nodeKindsOf([TOULMIN_TEMPLATE]);

function node(id: string, label?: string, selected = false): Node {
  return {
    id,
    position: { x: 0, y: 0 },
    data: label === undefined ? {} : { label },
    selected,
  } as Node;
}

/** preventDefault が呼ばれたかを見えるようにした右クリック */
function rightClick(x = 10, y = 20) {
  let prevented = false;
  const e = {
    clientX: x,
    clientY: y,
    preventDefault: () => {
      prevented = true;
    },
  } as unknown as MouseEvent;
  return { e, wasPrevented: () => prevented };
}

function setup(nodes: Node[], kinds = KINDS) {
  const events: GraphEvent[] = [];
  const hook = renderHook(() =>
    useNodeKindMenu(
      () => nodes,
      kinds,
      (e) => {
        events.push(e);
      },
    ),
  );
  return { ...hook, events };
}

describe('onNodeContextMenu', () => {
  it('右クリックしたノードを対象にし、現在の種別を持つ', () => {
    const { result } = setup([node('a', '主張')]);
    const { e } = rightClick();

    act(() => result.current.onNodeContextMenu(e, node('a', '主張')));

    expect(result.current.nodeKindMenu).toMatchObject({
      targetNodeIds: ['a'],
      currentLabel: '主張',
    });
  });

  it('種別を持たないノードの現在値は空文字 (「種別なし」が現在値になる)', () => {
    const { result } = setup([node('a')]);

    act(() => result.current.onNodeContextMenu(rightClick().e, node('a')));

    expect(result.current.nodeKindMenu?.currentLabel).toBe('');
  });

  it('選択中のノードが複数ならまとめて対象にする', () => {
    const nodes = [node('a', '主張', true), node('b', '主張', true), node('c')];
    const { result } = setup(nodes);

    act(() => result.current.onNodeContextMenu(rightClick().e, nodes[0]));

    expect(result.current.nodeKindMenu?.targetNodeIds).toEqual(['a', 'b']);
    expect(result.current.nodeKindMenu?.currentLabel).toBe('主張');
  });

  it('対象の種別が混在していれば現在値は null (どれも現在値にしない)', () => {
    const nodes = [node('a', '主張', true), node('b', 'データ', true)];
    const { result } = setup(nodes);

    act(() => result.current.onNodeContextMenu(rightClick().e, nodes[0]));

    expect(result.current.nodeKindMenu?.currentLabel).toBeNull();
  });

  it('template が当たっていなければ開かず、既定の右クリックも妨げない', () => {
    const { result } = setup([node('a')], []);
    const { e, wasPrevented } = rightClick();

    act(() => result.current.onNodeContextMenu(e, node('a')));

    expect(result.current.nodeKindMenu).toBeNull();
    expect(wasPrevented()).toBe(false);
  });
});

describe('setNodeKind', () => {
  it('NODE_LABEL_CHANGED を from/to つきで出す', () => {
    const { result, events } = setup([node('a', '主張')]);

    act(() => result.current.setNodeKind(['a'], 'データ'));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'NODE_LABEL_CHANGED',
      nodeId: 'a',
      from: '主張',
      to: 'データ',
      category: 'content',
    });
  });

  it('種別が無かったノードに与えるときの from は空文字', () => {
    const { result, events } = setup([node('a')]);

    act(() => result.current.setNodeKind(['a'], '主張'));

    expect(events[0]).toMatchObject({ from: '', to: '主張' });
  });

  it('空文字を選ぶと種別を外す', () => {
    const { result, events } = setup([node('a', '主張')]);

    act(() => result.current.setNodeKind(['a'], ''));

    expect(events[0]).toMatchObject({ from: '主張', to: '' });
  });

  it('変わらないものは op-log に積まない', () => {
    const nodes = [node('a', '主張'), node('b', 'データ')];
    const { result, events } = setup(nodes);

    act(() => result.current.setNodeKind(['a', 'b'], '主張'));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ nodeId: 'b', to: '主張' });
  });

  it('選び終えたらメニューを閉じる', () => {
    const { result } = setup([node('a')]);
    act(() => result.current.onNodeContextMenu(rightClick().e, node('a')));
    expect(result.current.nodeKindMenu).not.toBeNull();

    act(() => result.current.setNodeKind(['a'], '主張'));

    expect(result.current.nodeKindMenu).toBeNull();
  });
});
