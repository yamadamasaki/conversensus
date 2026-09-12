import { afterEach, describe, expect, it, mock } from 'bun:test';
import { nodeKindsOf, TOULMIN_TEMPLATE } from '@conversensus/shared';

const { render, screen, fireEvent, cleanup } = await import(
  '@testing-library/react'
);
const { NodeTypeMenu } = await import('./NodeTypeMenu');

const KINDS = nodeKindsOf([TOULMIN_TEMPLATE]);
const POS = { x: 0, y: 0 };

afterEach(() => cleanup());

describe('NodeTypeMenu', () => {
  it('template が当たっていなければ「種別」の段そのものが無い', () => {
    render(<NodeTypeMenu position={POS} nodeKinds={[]} onSelect={() => {}} />);

    expect(screen.getByText('ノードの見た目')).toBeDefined();
    expect(screen.queryByText('ノードの種別')).toBeNull();
    expect(screen.queryByText('主張')).toBeNull();
  });

  it('template が当たっていれば 2 段になる', () => {
    render(
      <NodeTypeMenu position={POS} nodeKinds={KINDS} onSelect={() => {}} />,
    );

    expect(screen.getByText('ノードの見た目')).toBeDefined();
    expect(screen.getByText('ノードの種別')).toBeDefined();
    for (const label of ['主張', 'データ', '論拠', '反論', '裏付け']) {
      expect(screen.getByText(label)).toBeDefined();
    }
  });

  it('見た目を選ぶと種別を伴わない', () => {
    const onSelect = mock(() => {});
    render(
      <NodeTypeMenu position={POS} nodeKinds={KINDS} onSelect={onSelect} />,
    );

    fireEvent.click(screen.getByText('グループ'));

    expect(onSelect).toHaveBeenCalledWith('group');
  });

  it('種別を選ぶと見た目は markdown に決まり、NodeKindRef ごと渡す', () => {
    // 種別を持つのは意味のあるノードだけなので、種別の選択で見た目を訊き直さない。
    // 渡すのは label ではなく NodeKindRef — id が実体で label は表示であり (D3)、
    // さらに書き込み先のプロパティ名が template ごとに分かれるので template も要る
    const onSelect = mock(() => {});
    render(
      <NodeTypeMenu position={POS} nodeKinds={KINDS} onSelect={onSelect} />,
    );

    fireEvent.click(screen.getByText('反論'));

    expect(onSelect).toHaveBeenCalledWith(
      'markdown',
      expect.objectContaining({
        templateId: 'jp.co.metabolics.toulmin',
        kind: expect.objectContaining({ id: 'rebuttal', label: '反論' }),
      }),
    );
  });

  it('種別の説明を title に出す (5 つの語だけでは意味が分からない)', () => {
    render(
      <NodeTypeMenu position={POS} nodeKinds={KINDS} onSelect={() => {}} />,
    );

    expect(screen.getByText('論拠').getAttribute('title')).toBe(
      'データが主張を支える理由づけ',
    );
  });
});
