import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { Batch, Did, NodeId } from '@conversensus/shared';

const { render, screen, fireEvent, cleanup } = await import(
  '@testing-library/react'
);
const { OverwriteNotice } = await import('./OverwriteNotice');
type OverwriteReport = import('./sync/overwrites').OverwriteReport;

const NODE = 'aaaaaaaa-0000-4000-8000-000000000000' as NodeId;
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000000' as NodeId;
const BOB = 'did:plc:bob' as Did;

const LABELS: Record<string, string> = { [NODE]: '要件A', [OTHER]: '要件B' };
const labelOf = (target: string) => LABELS[target] ?? target;
const actorLabelOf = (did: Did) => (did === BOB ? 'bob.test' : did);

const onDismiss = mock(() => {});

afterEach(() => {
  cleanup();
  onDismiss.mockClear();
});

const report = (
  over: Partial<OverwriteReport> & Pick<OverwriteReport, 'category'>,
): OverwriteReport => ({
  target: NODE,
  by: BOB,
  mine: 'l1' as Batch['id'],
  theirs: 'r1' as Batch['id'],
  ...over,
});

const renderNotice = (reports: OverwriteReport[]) =>
  render(
    <OverwriteNotice
      reports={reports}
      labelOf={labelOf}
      actorLabelOf={actorLabelOf}
      onDismiss={onDismiss}
    />,
  );

describe('OverwriteNotice', () => {
  it('報告が無ければ何も出さない', () => {
    const { container } = renderNotice([]);
    expect(container.firstChild).toBeNull();
  });

  it('🔴 一覧は畳んだ状態で出る (自動では開かない)', () => {
    renderNotice([report({ category: 'content' })]);
    // 印 (件数) は常に読める
    expect(
      screen.getByText(/あなたが書いた 1 件が, 相手の編集で変わりました/),
    ).toBeTruthy();
    // 中身は畳まれている — details が閉じていることを構造で見る
    const details = document.querySelector('details');
    expect(details?.open).toBe(false);
  });

  it('🔴 「競合」とは言わない (並行だったと言い切れないため)', () => {
    renderNotice([report({ category: 'content' })]);
    expect(document.body.textContent).not.toContain('競合');
  });

  it('🔴 読み上げに割り込まない (自動で鳴らさない決着を live region でも守る)', () => {
    renderNotice([report({ category: 'content' })]);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByLabelText('上書きの報告')).toBeTruthy();
  });

  it('🔴 対象は名前で出す (id は UUID なので出しても分からない)', () => {
    renderNotice([report({ category: 'content' })]);
    expect(screen.getByText('要件A')).toBeTruthy();
    expect(document.body.textContent).not.toContain(NODE);
  });

  it('誰の編集で変わったかを出す', () => {
    renderNotice([report({ category: 'content' })]);
    expect(document.body.textContent).toContain('bob.test');
  });

  it('3 段それぞれを言い分ける', () => {
    renderNotice([
      report({ category: 'content' }),
      report({ category: 'content', target: OTHER, propertyName: '締切' }),
      report({ category: 'structure', target: OTHER }),
      report({ category: 'layout', aspect: 'size' }),
    ]);
    expect(document.body.textContent).toContain('内容が書き換えられました');
    expect(document.body.textContent).toContain(
      'プロパティ「締切」が別の値になりました',
    );
    expect(document.body.textContent).toContain('つなぎ方が変えられました');
    expect(document.body.textContent).toContain('大きさが変えられました');
  });

  it('同じ対象でも観点が違えば別の行になる', () => {
    renderNotice([
      report({ category: 'layout', aspect: 'position' }),
      report({ category: 'layout', aspect: 'size' }),
    ]);
    expect(document.querySelectorAll('li')).toHaveLength(2);
  });

  it('消すと呼び出し側へ伝える', () => {
    renderNotice([report({ category: 'content' })]);
    fireEvent.click(screen.getByLabelText('上書きの報告を消す'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
