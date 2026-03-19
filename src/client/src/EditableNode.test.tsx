import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

// bun では mock.module() はホイストされないため, await import() の前に呼ぶことで
// EditableNode が @xyflow/react を読み込む前にモックを登録できる
const mockSetNodes = mock((_updater: unknown) => {});

mock.module('@xyflow/react', () => ({
  // biome-ignore lint/suspicious/noExplicitAny: テスト用スタブ
  Handle: (_props: any) => null,
  Position: { Top: 'top', Bottom: 'bottom' },
  useReactFlow: () => ({ setNodes: mockSetNodes }),
}));

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
  });

  afterEach(() => {
    cleanup();
  });

  it('ラベルを表示する', () => {
    render(<EditableNode {...makeProps()} />);
    expect(screen.getByText('テストノード')).toBeDefined();
  });

  it('空ラベルでもレンダリングできる', () => {
    render(<EditableNode {...makeProps('')} />);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('ダブルクリックで編集モードに切り替わる', () => {
    render(<EditableNode {...makeProps()} />);
    fireEvent.dblClick(screen.getByText('テストノード'));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input).toBeDefined();
    expect(input.value).toBe('テストノード');
  });

  it('Enter で確定し setNodes を呼び出す', () => {
    render(<EditableNode {...makeProps()} />);
    fireEvent.dblClick(screen.getByText('テストノード'));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '新しい内容' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockSetNodes).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('Escape でキャンセルし setNodes を呼ばない', () => {
    render(<EditableNode {...makeProps()} />);
    fireEvent.dblClick(screen.getByText('テストノード'));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '変更しない' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(mockSetNodes).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('IME 変換中 (compositionStart 後) は Enter で確定しない', () => {
    render(<EditableNode {...makeProps()} />);
    fireEvent.dblClick(screen.getByText('テストノード'));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockSetNodes).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toBeDefined(); // まだ編集中
  });

  it('compositionEnd 後は Enter で確定できる', () => {
    render(<EditableNode {...makeProps()} />);
    fireEvent.dblClick(screen.getByText('テストノード'));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.compositionStart(input);
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockSetNodes).toHaveBeenCalledTimes(1);
  });
});
