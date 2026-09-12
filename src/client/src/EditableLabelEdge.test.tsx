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
  getSmoothStepPath: () => ['M0,0 L100,100', 50, 50],
  getStraightPath: () => ['M0,0 L100,100', 50, 50],
  useReactFlow: () => ({ setEdges: mockSetEdges }),
}));

const mockDispatch = mock((_event: unknown) => {});
const mockSetDragging = mock((_dragging: boolean) => {});

mock.module('./EventDispatchContext', () => ({
  useEventDispatch: () => ({
    dispatch: mockDispatch,
    setDragging: mockSetDragging,
  }),
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
    mockDispatch.mockClear();
    mockSetDragging.mockClear();
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

  describe('template の種類を持つ edge (Phase 5)', () => {
    const KIND = 'jp.co.metabolics.toulmin.kind';
    const fromTemplate = (): TestEdgeProps => ({
      ...makeProps('支える'),
      data: { properties: { [KIND]: 'supports' } },
    });

    it('ラベルは出すが、ダブルクリックしても編集に入らない', () => {
      // 種類は両端の node から決まるものなので、人が名前を付けるものではない
      // (仕様 OnMutation: label は変更できない)
      render(<EditableLabelEdge {...fromTemplate()} />);

      fireEvent.dblClick(screen.getByText('支える'));

      expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('エッジの線をダブルクリックしても編集に入らない', () => {
      // 入口が 2 つある (ラベルと線) ので、片方だけ塞いでも意味が無い
      const { container } = render(<EditableLabelEdge {...fromTemplate()} />);
      const path = container.querySelector('path[stroke="transparent"]');
      if (!path) throw new Error('当たり判定の path が無い');

      fireEvent.dblClick(path);

      expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('種類を持たない edge は今までどおり編集できる', () => {
      // toulmin でない node が絡む edge は自由である (仕様)
      render(<EditableLabelEdge {...makeProps('つながり')} />);

      fireEvent.dblClick(screen.getByText('つながり'));

      expect(screen.getByRole('textbox')).toBeDefined();
    });
  });

  it('Enter で確定し EDGE_RELABELED を dispatch する', () => {
    render(<EditableLabelEdge {...makeProps('テストラベル')} />);
    fireEvent.dblClick(screen.getByText('テストラベル'));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '新しいラベル' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect((mockDispatch.mock.calls[0][0] as { type: string }).type).toBe(
      'EDGE_RELABELED',
    );
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('Escape でキャンセルし dispatch を呼ばない', () => {
    render(<EditableLabelEdge {...makeProps('テストラベル')} />);
    fireEvent.dblClick(screen.getByText('テストラベル'));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '変更しない' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('onBlur で確定し EDGE_RELABELED を dispatch する', () => {
    render(<EditableLabelEdge {...makeProps('テストラベル')} />);
    fireEvent.dblClick(screen.getByText('テストラベル'));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '変更内容' } });
    fireEvent.blur(input);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect((mockDispatch.mock.calls[0][0] as { type: string }).type).toBe(
      'EDGE_RELABELED',
    );
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('IME 変換中 (compositionStart 後) は Enter で確定しない', () => {
    render(<EditableLabelEdge {...makeProps('テストラベル')} />);
    fireEvent.dblClick(screen.getByText('テストラベル'));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toBeDefined(); // まだ編集中
  });

  it('compositionEnd 後は Enter で確定できる', () => {
    render(<EditableLabelEdge {...makeProps('テストラベル')} />);
    fireEvent.dblClick(screen.getByText('テストラベル'));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '変換後テキスト' } });
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect((mockDispatch.mock.calls[0][0] as { type: string }).type).toBe(
      'EDGE_RELABELED',
    );
  });
});
