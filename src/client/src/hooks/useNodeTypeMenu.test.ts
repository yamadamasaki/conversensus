import { describe, expect, it } from 'bun:test';
import type { NodeId } from '@conversensus/shared';
import { act, renderHook } from '@testing-library/react';
import type { Node } from '@xyflow/react';
import type { MouseEvent } from 'react';
import { useNodeTypeMenu } from './useNodeTypeMenu';

// 画面座標 → canvas 座標。ずれを入れて「変換を通している」ことを見えるようにする
const SCREEN_TO_FLOW_OFFSET = 1000;
const screenToFlow = (p: { x: number; y: number }) => ({
  x: p.x + SCREEN_TO_FLOW_OFFSET,
  y: p.y + SCREEN_TO_FLOW_OFFSET,
});

function node(id: string, x: number, y: number, parentId?: string): Node {
  return {
    id,
    position: { x, y },
    data: {},
    ...(parentId ? { parentId } : {}),
  } as Node;
}

// outer(100,100) > inner(50,50) → inner の絶対座標は (150,150)
const outer = node('outer', 100, 100);
const inner = node('inner', 50, 50, 'outer');
const getNodes = () => [outer, inner];

const click = (x: number, y: number) =>
  ({ clientX: x, clientY: y }) as MouseEvent;

function setup() {
  return renderHook(() => useNodeTypeMenu(screenToFlow, getNodes));
}

describe('openNodeTypeMenu', () => {
  it('コンテナ未指定ならメニューの位置は canvas 座標そのもの', () => {
    const { result } = setup();

    act(() => result.current.openNodeTypeMenu({ x: 10, y: 20 }));

    expect(result.current.nodeTypeMenu).toEqual({
      screenPos: { x: 10, y: 20 },
      position: { x: 1010, y: 1020 },
    });
  });

  it('コンテナ指定ならそのコンテナから見た相対座標になる', () => {
    const { result } = setup();

    act(() =>
      result.current.openNodeTypeMenu({ x: 10, y: 20 }, 'outer' as NodeId),
    );

    // canvas (1010,1020) − outer の絶対座標 (100,100)
    expect(result.current.nodeTypeMenu?.position).toEqual({
      x: 910,
      y: 920,
    });
    expect(result.current.nodeTypeMenu?.containerId).toBe('outer' as NodeId);
  });

  // 入れ子のグループでは親の位置だけ引いても足りない。祖先を辿った絶対座標から
  // 引く必要があるので, 2 段の入れ子で固定する
  it('入れ子のグループでは祖先まで辿った絶対座標を基準にする', () => {
    const { result } = setup();

    act(() =>
      result.current.openNodeTypeMenu({ x: 10, y: 20 }, 'inner' as NodeId),
    );

    // canvas (1010,1020) − inner の絶対座標 (150,150)
    expect(result.current.nodeTypeMenu?.position).toEqual({
      x: 860,
      y: 870,
    });
  });

  it('clearNodeTypeMenu で閉じる', () => {
    const { result } = setup();

    act(() => result.current.openNodeTypeMenu({ x: 10, y: 20 }));
    act(() => result.current.clearNodeTypeMenu());

    expect(result.current.nodeTypeMenu).toBeNull();
  });
});

// pane では ReactFlow がイベントを握るため React の onDoubleClick が使えず、
// クリックの間隔と距離から自前で判定している。その判定を固定する
describe('onPaneClick によるダブルクリック判定', () => {
  it('1 回のクリックではメニューを出さない', () => {
    const { result } = setup();

    act(() => result.current.onPaneClick(click(30, 40)));

    expect(result.current.nodeTypeMenu).toBeNull();
  });

  it('同じ場所を続けてクリックするとメニューが出る', () => {
    const { result } = setup();

    act(() => result.current.onPaneClick(click(30, 40)));
    act(() => result.current.onPaneClick(click(30, 40)));

    expect(result.current.nodeTypeMenu?.screenPos).toEqual({ x: 30, y: 40 });
    // pane なので生成先コンテナは無い
    expect(result.current.nodeTypeMenu?.containerId).toBeUndefined();
  });

  it('離れた場所への 2 回目のクリックでは出さない', () => {
    const { result } = setup();

    act(() => result.current.onPaneClick(click(30, 40)));
    act(() => result.current.onPaneClick(click(300, 400)));

    expect(result.current.nodeTypeMenu).toBeNull();
  });

  it('ESC で閉じる', () => {
    const { result } = setup();

    act(() => result.current.openNodeTypeMenu({ x: 10, y: 20 }));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(result.current.nodeTypeMenu).toBeNull();
  });
});
