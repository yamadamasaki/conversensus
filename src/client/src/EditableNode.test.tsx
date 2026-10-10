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
const { MARKDOWN_COMPONENTS } = await import('./markdownComponents');
const { ReadOnlyProvider } = await import('./readOnlyContext');
const { DERIVED_FROM_SHEET_PROPERTY } = await import('@conversensus/shared');

// NodeProps の最小スタブ
// biome-ignore lint/suspicious/noExplicitAny: テスト用 NodeProps スタブ
type TestNodeProps = any;
const makeProps = (label = 'テストノード'): TestNodeProps => ({
  id: 'node-1',
  data: { content: label },
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

  it('内容を表示する', () => {
    render(<EditableNode {...makeProps()} />);
    expect(screen.getByText('テストノード')).toBeDefined();
  });

  it('内容を ReactMarkdown で描画する', () => {
    render(<EditableNode {...makeProps('**太字**')} />);
    expect(mockReactMarkdown).toHaveBeenCalled();
    expect(screen.getByTestId('markdown')).toBeDefined();
  });

  it('Markdown は画像をリンクにし、リンクを新しいタブで開く描き方で描く (#287)', () => {
    render(<EditableNode {...makeProps('![](https://example.com/x.png)')} />);
    const props = mockReactMarkdown.mock.calls.at(-1)?.[0] as {
      components?: unknown;
    };
    expect(props.components).toBe(MARKDOWN_COMPONENTS);
  });

  it('内容が空なら編集促進テキストを表示する', () => {
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

  it('onBlur で確定し NODE_CONTENT_CHANGED を dispatch する', () => {
    render(<EditableNode {...makeProps()} />);
    fireEvent.dblClick(screen.getByText('テストノード'));
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '変更内容' } });
    fireEvent.blur(textarea);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect((mockDispatch.mock.calls[0][0] as { type: string }).type).toBe(
      'NODE_CONTENT_CHANGED',
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

  describe('ラベル (Phase 5)', () => {
    const KIND = 'jp.co.metabolics.toulmin.kind';
    /** template の種別を持つ node (ラベルは変更できない) */
    const templateNode = (label: string): TestNodeProps => ({
      ...makeProps('本文'),
      data: { content: '本文', label, properties: { [KIND]: 'claim' } },
    });
    /** その他の node (ラベルは自由) */
    const withKind = (label?: string, selected = false): TestNodeProps => ({
      ...makeProps('本文'),
      selected,
      data: { content: '本文', ...(label ? { label } : {}) },
    });

    it('ラベルがあれば本文と並べて出す', () => {
      render(<EditableNode {...templateNode('主張')} />);

      expect(screen.getByText('主張')).toBeDefined();
      expect(screen.getByText('本文')).toBeDefined();
    });

    it('ラベルが無く選択もされていなければ何も出さない', () => {
      // 常に出すと、ラベルを使わない普通のグラフが賑やかになる
      const { container } = render(<EditableNode {...withKind()} />);

      expect(container.querySelector('[data-node-label]')).toBeNull();
    });

    it('template の種別は編集の口を出さない — 変更できない (仕様 OnMutation)', () => {
      const { container } = render(<EditableNode {...templateNode('主張')} />);
      const chip = container.querySelector('[data-node-label]');

      // **button ではなく div。**押せそうに見えて押せない要素にしない
      expect(chip?.tagName.toLowerCase()).toBe('div');
      expect(chip?.getAttribute('data-editable')).toBeNull();
    });

    it('その他の node のラベルは編集できる — 仕様が「自由に付け、変更できる」と言う', () => {
      const { container } = render(<EditableNode {...withKind('私見')} />);
      const chip = container.querySelector('[data-node-label]');

      expect(chip?.tagName.toLowerCase()).toBe('button');
      expect(chip?.getAttribute('data-editable')).toBe('true');
    });

    it('ラベルを持たない node には、選択中だけ付ける口を出す', () => {
      const { container } = render(
        <EditableNode {...withKind(undefined, true)} />,
      );
      const chip = container.querySelector('[data-node-label]');

      expect(chip?.textContent).toBe('ラベル');
      expect(chip?.tagName.toLowerCase()).toBe('button');
    });

    it('template の種別を持つ node では、選択中でも付ける口を出さない', () => {
      // 既に種別があり、しかも変更できないので、足す口があってはいけない
      const props = {
        ...templateNode('主張'),
        selected: true,
      } as TestNodeProps;
      const { container } = render(<EditableNode {...props} />);

      expect(container.querySelector('[data-editable]')).toBeNull();
    });

    it('読み取り専用の画面では、選択中でも付ける口を出さず、あるラベルも編集の口にしない (step3 Phase 5)', () => {
      // merger の見るだけの pane は選択が連動するので、選択中の node がここに当たる
      const { container, rerender } = render(
        <ReadOnlyProvider value={true}>
          <EditableNode {...withKind(undefined, true)} />
        </ReadOnlyProvider>,
      );
      expect(container.querySelector('[data-node-label]')).toBeNull();

      rerender(
        <ReadOnlyProvider value={true}>
          <EditableNode {...withKind('私見', true)} />
        </ReadOnlyProvider>,
      );
      const chip = container.querySelector('[data-node-label]');
      expect(chip?.tagName.toLowerCase()).toBe('div');
      expect(chip?.textContent).toBe('私見');
      // 本文もダブルクリックで編集に入らない
      fireEvent.doubleClick(screen.getByText('本文'));
      expect(container.querySelector('textarea')).toBeNull();
    });

    it('クリック 1 回で編集に入り、確定すると NODE_LABEL_CHANGED を出す', () => {
      const { container } = render(<EditableNode {...withKind('私見')} />);
      const chip = container.querySelector('[data-node-label]');
      if (!chip) throw new Error('ラベルが無い');

      fireEvent.click(chip);
      const input = container.querySelector('[data-node-label-input]');
      if (!input) throw new Error('編集に入っていない');

      fireEvent.change(input, { target: { value: '反対意見' } });
      fireEvent.blur(input);

      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'NODE_LABEL_CHANGED',
          from: '私見',
          to: '反対意見',
        }),
      );
    });

    it('値が変わらなければ op-log に積まない', () => {
      const { container } = render(<EditableNode {...withKind('私見')} />);
      const chip = container.querySelector('[data-node-label]');
      if (!chip) throw new Error('ラベルが無い');

      fireEvent.click(chip);
      const input = container.querySelector('[data-node-label-input]');
      if (!input) throw new Error('編集に入っていない');
      fireEvent.blur(input);

      expect(
        mockDispatch.mock.calls.filter(
          (c) => (c[0] as { type: string }).type === 'NODE_LABEL_CHANGED',
        ),
      ).toHaveLength(0);
    });
  });

  describe('label の口の置き場と差分の印 (visual language §8, #272 #258)', () => {
    const plain = (
      selected: boolean,
      data: Record<string, unknown> = { content: '本文' },
    ): TestNodeProps => ({ ...makeProps('本文'), selected, data });

    it('label の無い node を選ぶと、口は本文の外に出る — 選んでも本文がずれない', () => {
      const { container } = render(<EditableNode {...plain(true)} />);
      const chip = container.querySelector('[data-node-label]');
      const body = container.querySelector('[data-node-body]');

      expect(chip).not.toBeNull();
      expect(body?.contains(chip)).toBe(false);
    });

    it('label があれば本文の一部として中に置く (選択で出たり消えたりしない)', () => {
      const { container } = render(
        <EditableNode {...plain(false, { content: '本文', label: '私見' })} />,
      );
      const chip = container.querySelector('[data-node-label]');

      expect(container.querySelector('[data-node-body]')?.contains(chip)).toBe(
        true,
      );
    });

    it('metagraph の graph node には、選んでも label の口を出さない (#258)', () => {
      const sheetId = '00000000-0000-4000-8000-000000000001';
      const { container } = render(
        <EditableNode
          {...plain(true, {
            content: 'Sheet 1',
            properties: { [DERIVED_FROM_SHEET_PROPERTY]: sheetId },
          })}
        />,
      );

      expect(container.querySelector('[data-node-label]')).toBeNull();
    });

    it('差分の node には、色だけでなく形の印を添える (追加 / 変更)', () => {
      const { container, rerender } = render(
        <EditableNode
          {...plain(false, { content: '本文', diffType: 'add' })}
        />,
      );
      expect(
        container.querySelector('[data-diff-mark]')?.getAttribute('aria-label'),
      ).toBe('追加');

      rerender(
        <EditableNode
          {...plain(false, { content: '本文', diffType: 'update' })}
        />,
      );
      expect(
        container.querySelector('[data-diff-mark]')?.getAttribute('aria-label'),
      ).toBe('変更');

      rerender(<EditableNode {...plain(false)} />);
      expect(container.querySelector('[data-diff-mark]')).toBeNull();
    });
  });

  describe('ghost (削除予定表示)', () => {
    const makeGhostProps = (label = '削除予定'): TestNodeProps => ({
      ...makeProps(label),
      data: { content: label, ghost: true },
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
