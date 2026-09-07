import { afterEach, describe, expect, it, mock } from 'bun:test';
import type {
  Batch,
  EdgeId,
  MergeConflict,
  NodeId,
} from '@conversensus/shared';

const { render, screen, fireEvent, cleanup } = await import(
  '@testing-library/react'
);
const { ConflictNotice } = await import('./ConflictNotice');

const NODE = 'aaaaaaaa-0000-4000-8000-000000000000' as NodeId;
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000000' as NodeId;
const EDGE = 'cccccccc-0000-4000-8000-000000000000' as EdgeId;

const LABELS: Record<string, string> = {
  [NODE]: '要件A',
  [OTHER]: '要件B',
  [EDGE]: 'つながり',
};
const labelOf = (target: string) => LABELS[target] ?? target;

const onClose = mock(() => {});

afterEach(() => {
  cleanup();
  onClose.mockClear();
});

const side = (batchId: string) => ({
  batchId: batchId as Batch['id'],
  op: { kind: 'node.setContent' as const, target: NODE, content: 'x' },
});

const content = (target: string, propertyName?: string): MergeConflict => ({
  target,
  category: 'content',
  ...(propertyName !== undefined && { propertyName }),
  ours: side('t1'),
  theirs: side('b1'),
});

const structure = (
  target: string,
  kind: 'removeDependency' | 'parallelChange',
): MergeConflict => ({
  target,
  category: 'structure',
  kind,
  ours: side('t2'),
  theirs: side('b2'),
});

const layout = (
  target: string,
  aspect: 'position' | 'size' | 'route',
): MergeConflict => ({
  target,
  category: 'layout',
  aspect,
  ours: side('t3'),
  theirs: side('b3'),
});

const renderNotice = (conflicts: MergeConflict[], forkCount = 0) =>
  render(
    <ConflictNotice
      conflicts={conflicts}
      labelOf={labelOf}
      forkCount={forkCount}
      onClose={onClose}
    />,
  );

describe('ConflictNotice', () => {
  it('競合が無ければ何も出さない', () => {
    // merge のたびに空の通知が出ると、通知そのものが信用されなくなる
    const { container } = renderNotice([]);
    expect(container.firstChild).toBeNull();
  });

  it('総件数を見出しに出す', () => {
    renderNotice([content(NODE), layout(OTHER, 'position')]);
    expect(screen.getByText(/2 件の競合/)).toBeTruthy();
  });

  it('🔴 3 段を段ごとに分けて出す', () => {
    renderNotice([
      content(NODE),
      structure(OTHER, 'removeDependency'),
      layout(EDGE, 'route'),
    ]);
    expect(screen.getByText('内容の競合 1 件')).toBeTruthy();
    expect(screen.getByText('構造の競合 1 件')).toBeTruthy();
    expect(screen.getByText('位置・大きさの競合 1 件')).toBeTruthy();
  });

  it('無い段は出さない', () => {
    renderNotice([layout(NODE, 'position')]);
    expect(screen.queryByText(/内容の競合/)).toBeNull();
    expect(screen.queryByText(/構造の競合/)).toBeNull();
  });

  /**
   * ここが 3 段にした意味そのものである。件数を並べるだけなら段は要らない。
   * **人の判断が要るのか、結果の報告なのか**が読めることを固定する。
   */
  it('🔴 段ごとに「どう扱われるか」を書く', () => {
    renderNotice([
      content(NODE),
      structure(OTHER, 'removeDependency'),
      layout(EDGE, 'position'),
    ]);
    expect(screen.getByText(/どちらを採るかは対話で決めます/)).toBeTruthy();
    expect(screen.getByText(/もう片方の前提を壊しています/)).toBeTruthy();
    expect(screen.getByText(/対話は起こしません/)).toBeTruthy();
  });

  /**
   * layout は日常的に起きるので、開いたままだと通知が layout の一覧で埋まり、
   * 決着が要る段が押し出される。**扱いの違いを開閉で表す。**
   */
  it('🔴 content / structure は開き、layout は畳んで出す', () => {
    const { container } = renderNotice([
      content(NODE),
      structure(OTHER, 'removeDependency'),
      layout(EDGE, 'position'),
    ]);
    const details = [...container.querySelectorAll('details')];
    expect(details.map((d) => d.open)).toEqual([true, true, false]);
  });

  it('段の並びは content → structure → layout (急ぐものが上)', () => {
    const { container } = renderNotice([
      layout(EDGE, 'position'),
      structure(OTHER, 'parallelChange'),
      content(NODE),
    ]);
    const titles = [...container.querySelectorAll('summary')].map(
      (s) => s.textContent,
    );
    expect(titles).toEqual([
      '内容の競合 1 件',
      '構造の競合 1 件',
      '位置・大きさの競合 1 件',
    ]);
  });

  it('🔴 対象は id ではなく名前で出す', () => {
    // target は UUID なので、出しても何のことか分からない
    renderNotice([content(NODE)]);
    expect(screen.getByText('要件A')).toBeTruthy();
    expect(screen.queryByText(NODE)).toBeNull();
  });

  it('名前が引けなければ id を出す (黙って落とさない)', () => {
    const unknown = 'dddddddd-0000-4000-8000-000000000000';
    renderNotice([content(unknown)]);
    expect(screen.getByText(unknown)).toBeTruthy();
  });

  it('content はプロパティ名があればそれを出す (#208 の粒度)', () => {
    renderNotice([content(NODE, '期限')]);
    expect(screen.getByText(/プロパティ「期限」/)).toBeTruthy();
  });

  it('structure は削除依存と並行変更を書き分ける', () => {
    renderNotice([
      structure(NODE, 'removeDependency'),
      structure(OTHER, 'parallelChange'),
    ]);
    expect(screen.getByText(/片方が消したものを/)).toBeTruthy();
    expect(screen.getByText(/つなぎ方を二人が別々に/)).toBeTruthy();
  });

  it('layout は観点 (位置 / 大きさ / 経路) を書き分ける', () => {
    renderNotice([
      layout(NODE, 'position'),
      layout(OTHER, 'size'),
      layout(EDGE, 'route'),
    ]);
    expect(screen.getByText(/位置を二人が/)).toBeTruthy();
    expect(screen.getByText(/大きさを二人が/)).toBeTruthy();
    expect(screen.getByText(/経路を二人が/)).toBeTruthy();
  });

  it('同じ対象の複数の競合を並べて出せる (観点ごとに 1 行)', () => {
    // 移動とリサイズは別の単位なので 2 件になる (T3)。1 件に潰さない
    const { container } = renderNotice([
      layout(NODE, 'position'),
      layout(NODE, 'size'),
    ]);
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });

  it('🔴 保留として記録したことを出す (Phase 3 T6)', () => {
    // 通知だけでは消えてしまう。後から「何でこれが生じたんだ?」に答えられるのは
    // 記録の方である
    renderNotice([content(NODE), structure(OTHER, 'removeDependency')], 2);
    expect(screen.getByText(/2 件を保留として記録しました/)).toBeTruthy();
  });

  it('保留していなければその行は出さない (explicit merge)', () => {
    // 人が押した merge は保留ではなく取り込みである
    renderNotice([content(NODE)]);
    expect(screen.queryByText(/保留として記録/)).toBeNull();
  });

  it('閉じられる', () => {
    renderNotice([content(NODE)]);
    fireEvent.click(screen.getByRole('button', { name: '競合の通知を閉じる' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('モーダルではない (背後の操作を止めない)', () => {
    // layout の競合は日常的に起きる。毎回モーダルで止めると作業の障害物になる
    renderNotice([layout(NODE, 'position')]);
    const notice = screen.getByRole('status');
    expect(notice.getAttribute('aria-modal')).toBeNull();
  });
});
