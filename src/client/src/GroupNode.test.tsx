import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

// bun では mock.module() はホイストされないため, await import() の前に呼ぶ
mock.module('@xyflow/react', () => ({
  // biome-ignore lint/suspicious/noExplicitAny: テスト用スタブ
  NodeResizer: (_props: any) => null,
  useReactFlow: () => ({ getNode: () => undefined }),
}));

const mockDispatch = mock((_event: unknown) => {});

mock.module('./EventDispatchContext', () => ({
  useEventDispatch: () => ({
    dispatch: mockDispatch,
    setDragging: mock((_dragging: boolean) => {}),
  }),
}));

const mockOpenNodeTypeMenu = mock(
  (_screenPos: { x: number; y: number }, _containerId?: string) => {},
);

mock.module('./NodeCreationContext', () => ({
  useNodeCreation: () => ({ openNodeTypeMenu: mockOpenNodeTypeMenu }),
}));

const { render, fireEvent, cleanup } = await import('@testing-library/react');
const { GroupNode } = await import('./GroupNode');

const GROUP_ID = 'group-1';

// biome-ignore lint/suspicious/noExplicitAny: テスト用 NodeProps スタブ
const makeProps = (): any => ({
  id: GROUP_ID,
  data: { label: 'グループ' },
  type: 'groupNode',
  isConnectable: true,
  selected: false,
  dragging: false,
  positionAbsoluteX: 100,
  positionAbsoluteY: 100,
  zIndex: 0,
});

/** 本体エリア (タイトルバーの下の, ダブルクリックで子を作る領域) */
function bodyArea(container: HTMLElement): HTMLElement {
  const body = container.querySelector('div > div > div:last-child');
  if (!body) throw new Error('グループ本体が見つからない');
  return body as HTMLElement;
}

describe('GroupNode', () => {
  beforeEach(() => {
    mockDispatch.mockClear();
    mockOpenNodeTypeMenu.mockClear();
  });
  afterEach(cleanup);

  // 設計 D5: 生成経路を 1 本化する。以前はここで直接 markdown ノードを
  // dispatch していたため, グループ内では markdown しか作れなかった (ANA-110)
  it('本体のダブルクリックでノード種類メニューを開く (直接生成しない)', () => {
    const { container } = render(<GroupNode {...makeProps()} />);

    fireEvent.doubleClick(bodyArea(container), { clientX: 250, clientY: 180 });

    expect(mockOpenNodeTypeMenu).toHaveBeenCalledTimes(1);
    expect(mockOpenNodeTypeMenu.mock.calls[0]).toEqual([
      { x: 250, y: 180 },
      GROUP_ID,
    ]);
    // 種類が選ばれるまでは何も作らない
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('タイトルバーのダブルクリックではメニューを開かない (ラベル編集)', () => {
    const { container, getByDisplayValue } = render(
      <GroupNode {...makeProps()} />,
    );
    const title = container.querySelector('div > div > div');
    if (!title) throw new Error('タイトルバーが見つからない');

    fireEvent.doubleClick(title);

    expect(mockOpenNodeTypeMenu).not.toHaveBeenCalled();
    expect(getByDisplayValue('グループ')).toBeDefined();
  });

  it('ghost 表示ではダブルクリックしてもメニューを開かない', () => {
    const props = makeProps();
    props.data = { ...props.data, ghost: true };
    const { container } = render(<GroupNode {...props} />);

    fireEvent.doubleClick(bodyArea(container), { clientX: 250, clientY: 180 });

    expect(mockOpenNodeTypeMenu).not.toHaveBeenCalled();
  });
});
