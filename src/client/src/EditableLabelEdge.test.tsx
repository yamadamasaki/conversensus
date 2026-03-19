import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ReactNode } from 'react';

// bun では mock.module() はホイストされないため, await import() の前に呼ぶことで
// EditableLabelEdge が @xyflow/react を読み込む前にモックを登録できる
const mockSetEdges = mock((_updater: unknown) => {});

mock.module('@xyflow/react', () => ({
  BaseEdge: () => null,
  // EdgeLabelRenderer はポータルで描画するため, テスト用に children を直接レンダリング
  EdgeLabelRenderer: ({ children }: { children: ReactNode }) => <>{children}</>,
  getBezierPath: () => ['M0,0 L100,100', 50, 50],
  useReactFlow: () => ({ setEdges: mockSetEdges }),
}));

const { render, screen, fireEvent, cleanup } = await import(
  '@testing-library/react'
);
const { EditableLabelEdge } = await import('./EditableLabelEdge');

// EdgeProps の最小スタブ
// biome-ignore lint/suspicious/noExplicitAny: テスト用 EdgeProps スタブ
type TestEdgeProps = any;
const makeProps = (label?: string): TestEdgeProps => ({
  id: 'edge-1',
  label,
  sourceX: 0,
  sourceY: 0,
  targetX: 100,
  targetY: 100,
  sourcePosition: 'bottom',
  targetPosition: 'top',
  markerEnd: undefined,
  style: undefined,
});

describe('EditableLabelEdge', () => {
  beforeEach(() => {
    mockSetEdges.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('ラベルを表示する', () => {
    render(<EditableLabelEdge {...makeProps('テストラベル')} />);
    expect(screen.getByText('テストラベル')).toBeDefined();
  });

  it('ラベルが空/未定義の場合は span を表示しない', () => {
    render(<EditableLabelEdge {...makeProps()} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    // ラベルテキストが存在しないことを確認 (button 自体は描画される)
    expect(screen.getByRole('button').textContent).toBe('');
  });

  it('ラベルをダブルクリックで編集モードに切り替わる', () => {
    render(<EditableLabelEdge {...makeProps('テストラベル')} />);
    fireEvent.dblClick(screen.getByText('テストラベル'));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input).toBeDefined();
    expect(input.value).toBe('テストラベル');
  });

  it('ラベルなしでもボタンのダブルクリックで編集モードに切り替わる', () => {
    render(<EditableLabelEdge {...makeProps()} />);
    fireEvent.dblClick(screen.getByRole('button'));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input).toBeDefined();
    expect(input.value).toBe('');
  });

  it('Enter で確定し setEdges を呼び出す', () => {
    render(<EditableLabelEdge {...makeProps('テストラベル')} />);
    fireEvent.dblClick(screen.getByText('テストラベル'));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '新しいラベル' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockSetEdges).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('Escape でキャンセルし setEdges を呼ばない', () => {
    render(<EditableLabelEdge {...makeProps('テストラベル')} />);
    fireEvent.dblClick(screen.getByText('テストラベル'));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '変更しない' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(mockSetEdges).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('onBlur で確定し setEdges を呼び出す', () => {
    render(<EditableLabelEdge {...makeProps('テストラベル')} />);
    fireEvent.dblClick(screen.getByText('テストラベル'));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '変更内容' } });
    fireEvent.blur(input);
    expect(mockSetEdges).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('IME 変換中 (compositionStart 後) は Enter で確定しない', () => {
    render(<EditableLabelEdge {...makeProps('テストラベル')} />);
    fireEvent.dblClick(screen.getByText('テストラベル'));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockSetEdges).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toBeDefined(); // まだ編集中
  });

  it('compositionEnd 後は Enter で確定できる', () => {
    render(<EditableLabelEdge {...makeProps('テストラベル')} />);
    fireEvent.dblClick(screen.getByText('テストラベル'));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.compositionStart(input);
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockSetEdges).toHaveBeenCalledTimes(1);
  });
});
