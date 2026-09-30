import { afterEach, describe, expect, it } from 'bun:test';
import { renderHook } from '@testing-library/react';
import type { Node } from '@xyflow/react';
import type { MouseEvent } from 'react';
import type { GraphEvent } from '../events/GraphEvent';
import { RF_GROUP_NODE_TYPE } from '../graphTransform';
import {
  DROP_TARGET_ATTR,
  LEAVING_GROUP_ATTR,
  useNodeDragTracking,
} from './useNodeDragTracking';

const NO_EVENT = {} as MouseEvent;
const NODE_SIZE = { width: 100, height: 50 };
const GROUP_SIZE = { width: 400, height: 300 };

function node(id: string, x: number, y: number, parentId?: string): Node {
  return {
    id,
    position: { x, y },
    data: {},
    measured: NODE_SIZE,
    ...(parentId ? { parentId } : {}),
  } as Node;
}

function group(id: string, x: number, y: number): Node {
  return {
    id,
    type: RF_GROUP_NODE_TYPE,
    position: { x, y },
    data: {},
    style: GROUP_SIZE,
    measured: GROUP_SIZE,
  } as Node;
}

/** React Flow が描く node 要素の代わり。印はここに付く */
function renderNodeElement(id: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'react-flow__node';
  el.setAttribute('data-id', id);
  document.body.appendChild(el);
  return el;
}

function setup(initial: Node[]) {
  let nodes = initial;
  const dispatched: GraphEvent[] = [];
  const { result } = renderHook(() =>
    useNodeDragTracking(
      () => nodes,
      (e) => dispatched.push(e),
    ),
  );
  return {
    handlers: result.current,
    dispatched,
    moveTo: (next: Node[]) => {
      nodes = next;
    },
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useNodeDragTracking: 確定', () => {
  it('開始時に控えた位置を from にして NODE_MOVED を流す', () => {
    const { handlers, dispatched, moveTo } = setup([node('n1', 0, 0)]);

    handlers.onNodeDragStart(NO_EVENT, node('n1', 0, 0));
    // ドラッグ中に React Flow が位置を書き換える
    const moved = node('n1', 600, 0);
    moveTo([moved]);
    handlers.onNodeDragStop(NO_EVENT, moved, [moved]);

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({
      type: 'NODE_MOVED',
      nodeId: 'n1',
      from: { x: 0, y: 0 },
      to: { x: 600, y: 0 },
    });
  });

  it('動いていなければ何も流さない (クリックだけのドラッグ)', () => {
    const { handlers, dispatched } = setup([node('n1', 0, 0)]);

    handlers.onNodeDragStart(NO_EVENT, node('n1', 0, 0));
    handlers.onNodeDragStop(NO_EVENT, node('n1', 0, 0), [node('n1', 0, 0)]);

    expect(dispatched).toEqual([]);
  });
});

describe('useNodeDragTracking: ドラッグ中の印', () => {
  it('グループの上に来たら入る先に印を付け、確定で消す', () => {
    const g = group('g', 0, 0);
    const outside = node('n1', 1000, 1000);
    const { handlers, moveTo } = setup([g, outside]);
    const groupEl = renderNodeElement('g');

    handlers.onNodeDragStart(NO_EVENT, outside);
    const over = node('n1', 50, 50);
    moveTo([g, over]);
    handlers.onNodeDrag(NO_EVENT, over, [over]);
    expect(groupEl.getAttribute(DROP_TARGET_ATTR)).toBe('true');

    handlers.onNodeDragStop(NO_EVENT, over, [over]);
    expect(groupEl.hasAttribute(DROP_TARGET_ATTR)).toBe(false);
  });

  it('親のグループの外へ出たら、元の親に出る印を付ける', () => {
    const g = group('g', 0, 0);
    const child = node('n1', 50, 50, 'g');
    const { handlers, moveTo } = setup([g, child]);
    const groupEl = renderNodeElement('g');

    handlers.onNodeDragStart(NO_EVENT, child);
    // 親からの相対座標でグループの外 (幅 400 を越える)
    const leaving = node('n1', 1000, 1000, 'g');
    moveTo([g, leaving]);
    handlers.onNodeDrag(NO_EVENT, leaving, [leaving]);

    expect(groupEl.getAttribute(LEAVING_GROUP_ATTR)).toBe('true');
    expect(groupEl.hasAttribute(DROP_TARGET_ATTR)).toBe(false);
  });

  it('同じ親の中で動かしているだけなら印を付けない', () => {
    const g = group('g', 0, 0);
    const child = node('n1', 50, 50, 'g');
    const { handlers, moveTo } = setup([g, child]);
    const groupEl = renderNodeElement('g');

    handlers.onNodeDragStart(NO_EVENT, child);
    const within = node('n1', 60, 60, 'g');
    moveTo([g, within]);
    handlers.onNodeDrag(NO_EVENT, within, [within]);

    expect(groupEl.hasAttribute(DROP_TARGET_ATTR)).toBe(false);
    expect(groupEl.hasAttribute(LEAVING_GROUP_ATTR)).toBe(false);
  });
});
