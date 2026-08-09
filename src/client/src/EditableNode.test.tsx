import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ReactNode } from 'react';

// bun では mock.module() はホイストされないため, await import() の前に呼ぶことで
// EditableNode が @xyflow/react を読み込む前にモックを登録できる
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

// react-markdown: spy として呼び出しを記録しつつ children をレンダリング
const mockReactMarkdown = mock(({ children }: { children: ReactNode }) => (
  <span data-testid="markdown">{children}</span>
));

mock.module('react-markdown', () => ({ default: mockReactMarkdown }));

mock.module('remark-gfm', () => ({ default: () => {} }));

const { render, screen, fireEvent, cleanup } = await import(
  '@testing-library/react'
);
const { EditableNode } = await import('./EditableNode');

// NodeProps の最小スタブ
// biome-ignore lint/suspicious/noExplicitAny: テスト用 NodeProps スタブ
type TestNodeProps = any;
const makeProps = (label = 'テストノード'): TestNodeProps => ({
  id: 'node-1',
  data: { label },
  type: 'editableNode',
  isConnectable: true,
  selected: false,
  dragging: false,
  positionAbsoluteX: 0,
  positionAbsoluteY: 0,
  zIndex: 0,
});

describe('EditableNode', () => {
  beforeEach(() => {
    mockGetNode.mockClear();
    mockDispatch.mockClear();
    mockReactMarkdown.mockClear();
    mockHandle.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('ラベルを表示する', () => {
    render(<EditableNode {...makeProps()} />);
    expect(screen.getByText('テストノード')).toBeDefined();
  });

  it('ラベルを ReactMarkdown で描画する', () => {
    render(<EditableNode {...makeProps('**太字**')} />);
    expect(mockReactMarkdown).toHaveBeenCalled();
    expect(screen.getByTestId('markdown')).toBeDefined();
  });

  it('空ラベルでは編集促進テキストを表示する', () => {
    render(<EditableNode {...makeProps('')} />);
    expect(screen.getByText('ダブルクリックで編集')).toBeDefined();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('ダブルクリックで編集モードに切り替わる', () => {
    render(<EditableNode {...makeProps()} />);
    fireEvent.dblClick(screen.getByText('テストノード'));
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea).toBeDefined();
    expect(textarea.value).toBe('テストノード');
  });

  it('onBlur で確定し NODE_RELABELED を dispatch する', () => {
    render(<EditableNode {...makeProps()} />);
    fireEvent.dblClick(screen.getByText('テストノード'));
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '変更内容' } });
    fireEvent.blur(textarea);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect((mockDispatch.mock.calls[0][0] as { type: string }).type).toBe(
      'NODE_RELABELED',
    );
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('Escape でキャンセルし dispatch を呼ばない', () => {
    render(<EditableNode {...makeProps()} />);
    fireEvent.dblClick(screen.getByText('テストノード'));
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '変更しない' } });
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('Enter キーは改行のみで確定しない (textarea の自然な動作)', () => {
    render(<EditableNode {...makeProps()} />);
    fireEvent.dblClick(screen.getByText('テストノード'));
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toBeDefined(); // まだ編集中
  });

  describe('ghost (削除予定表示)', () => {
    const makeGhostProps = (label = '削除予定'): TestNodeProps => ({
      ...makeProps(label),
      data: { label, ghost: true },
    });

    it('ハンドルをすべて接続不可にする', () => {
      render(<EditableNode {...makeGhostProps()} />);
      // ghost からエッジを引けてしまうと, 存在しないノードを指すエッジが
      // trunk へ載りうる (孤児エッジ)
      expect(mockHandle).toHaveBeenCalled();
      for (const [props] of mockHandle.mock.calls) {
        expect(props.isConnectable).toBe(false);
      }
    });

    it('ハンドル自体は消さない (ghost エッジの端点として座標が要る)', () => {
      render(<EditableNode {...makeGhostProps()} />);
      const ids = mockHandle.mock.calls.map(([props]) => props.id);
      expect(ids).toEqual([
        'source-top',
        'source-bottom',
        'source-left',
        'source-right',
      ]);
    });

    it('通常のノードのハンドルは接続可能なまま', () => {
      render(<EditableNode {...makeProps()} />);
      expect(mockHandle).toHaveBeenCalled();
      for (const [props] of mockHandle.mock.calls) {
        expect(props.isConnectable).toBeUndefined();
      }
    });

    it('ダブルクリックしても編集モードにならない', () => {
      render(<EditableNode {...makeGhostProps()} />);
      fireEvent.dblClick(screen.getByText('削除予定'));
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });
});
