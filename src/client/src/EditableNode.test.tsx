import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ReactNode } from 'react';

// bun では mock.module() はホイストされないため, await import() の前に呼ぶことで
// EditableNode が @xyflow/react を読み込む前にモックを登録できる
const mockSetNodes = mock((_updater: unknown) => {});

mock.module('@xyflow/react', () => ({
  // biome-ignore lint/suspicious/noExplicitAny: テスト用スタブ
  Handle: (_props: any) => null,
  // biome-ignore lint/suspicious/noExplicitAny: テスト用スタブ
  NodeResizer: (_props: any) => null,
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
  useReactFlow: () => ({ setNodes: mockSetNodes }),
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
    mockSetNodes.mockClear();
    mockReactMarkdown.mockClear();
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

  it('onBlur で確定し setNodes を呼び出す', () => {
    render(<EditableNode {...makeProps()} />);
    fireEvent.dblClick(screen.getByText('テストノード'));
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '変更内容' } });
    fireEvent.blur(textarea);
    expect(mockSetNodes).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('Escape でキャンセルし setNodes を呼ばない', () => {
    render(<EditableNode {...makeProps()} />);
    fireEvent.dblClick(screen.getByText('テストノード'));
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '変更しない' } });
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(mockSetNodes).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('Enter キーは改行のみで確定しない (textarea の自然な動作)', () => {
    render(<EditableNode {...makeProps()} />);
    fireEvent.dblClick(screen.getByText('テストノード'));
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(mockSetNodes).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toBeDefined(); // まだ編集中
  });
});
