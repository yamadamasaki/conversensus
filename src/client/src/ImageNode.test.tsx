import { beforeEach, describe, expect, it, mock } from 'bun:test';

// bun では mock.module() はホイストされないため, await import() の前に呼ぶことで
// ImageNode が依存モジュールを読み込む前にモックを登録できる
const mockGetNode = mock((_id: string) => undefined);

// Handle は描画せず, 受け取った props だけを記録する。ghost の接続可否 (ANA-121) は
// DOM ではなく Handle へ渡した isConnectable で判定する
// biome-ignore lint/suspicious/noExplicitAny: テスト用スタブ
const mockHandle = mock((_props: any) => null);

mock.module('@xyflow/react', () => ({
  Handle: mockHandle,
  // biome-ignore lint/suspicious/noExplicitAny: テスト用スタブ
  NodeResizer: (_props: any) => null,
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
  useReactFlow: () => ({ getNode: mockGetNode }),
}));

const mockDispatch = mock((_event: unknown) => {});

mock.module('./EventDispatchContext', () => ({
  useEventDispatch: () => ({
    dispatch: mockDispatch,
    setDragging: mock((_dragging: boolean) => {}),
  }),
}));

// atproto/blob と atproto/client はモックしない。bun の mock.module はテストファイルを
// またいでグローバルに効くため, 部分的な差し替えが他のテストを壊す。blob 解決の経路は
// `imageBlobCid && imageBlobMimeType` で閉じているので, それを与えなければ呼ばれない
const { render, screen, fireEvent, cleanup } = await import(
  '@testing-library/react'
);
const { ImageNode } = await import('./ImageNode');

// NodeProps の最小スタブ
// biome-ignore lint/suspicious/noExplicitAny: テスト用 NodeProps スタブ
type TestNodeProps = any;
const makeProps = (label = '画像ノード'): TestNodeProps => ({
  id: 'node-1',
  data: { label, properties: { imageUrl: 'https://example.com/a.png' } },
  type: 'imageNode',
  isConnectable: true,
  selected: false,
  dragging: false,
  positionAbsoluteX: 0,
  positionAbsoluteY: 0,
  zIndex: 0,
});

const makeGhostProps = (label = '削除予定の画像'): TestNodeProps => ({
  ...makeProps(label),
  data: {
    label,
    ghost: true,
    properties: { imageUrl: 'https://example.com/a.png' },
  },
});

describe('ImageNode', () => {
  beforeEach(() => {
    cleanup();
    mockGetNode.mockClear();
    mockDispatch.mockClear();
    mockHandle.mockClear();
  });

  describe('ghost (削除予定表示)', () => {
    it('ハンドルをすべて接続不可にする', () => {
      render(<ImageNode {...makeGhostProps()} />);
      // ghost からエッジを引けてしまうと, 存在しないノードを指すエッジが
      // trunk へ載りうる (孤児エッジ)
      expect(mockHandle).toHaveBeenCalled();
      for (const [props] of mockHandle.mock.calls) {
        expect(props.isConnectable).toBe(false);
      }
    });

    it('ハンドル自体は消さない (ghost エッジの端点として座標が要る)', () => {
      render(<ImageNode {...makeGhostProps()} />);
      const ids = mockHandle.mock.calls.map(([props]) => props.id);
      expect(ids).toEqual([
        'source-top',
        'source-bottom',
        'source-left',
        'source-right',
      ]);
    });

    it('ラベルを取り消し線付きで表示し, 画像は描画しない', () => {
      render(<ImageNode {...makeGhostProps()} />);
      expect(screen.getByText('削除予定の画像')).toBeDefined();
      expect(screen.queryByRole('img')).toBeNull();
    });

    it('ダブルクリックしても編集モードにならない', () => {
      render(<ImageNode {...makeGhostProps()} />);
      fireEvent.dblClick(screen.getByText('削除予定の画像'));
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('通常のノード', () => {
    it('ハンドルは接続可能なまま', () => {
      render(<ImageNode {...makeProps()} />);
      expect(mockHandle).toHaveBeenCalled();
      for (const [props] of mockHandle.mock.calls) {
        expect(props.isConnectable).toBeUndefined();
      }
    });
  });
});
