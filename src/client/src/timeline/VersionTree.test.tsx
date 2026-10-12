import { afterEach, describe, expect, mock, test } from 'bun:test';
import {
  type Batch,
  BRANCH_STATUS,
  type BranchId,
  type BranchMeta,
  COMMIT_KIND,
  type CommitId,
  type FileId,
  type SheetId,
} from '@conversensus/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ChangePoint, TimelineLane } from './buildTimeline';
import { type TimelineSelection, VersionTree } from './VersionTree';

afterEach(cleanup);

const A = 'did:plc:alice#d1';
const B1 = 'b1' as BranchId;
const NONE = () => ({ nodeIds: new Set<string>(), edgeIds: new Set<string>() });

const change = (seq: number): ChangePoint => ({
  batch: {
    id: `batch-${seq}`,
    actor: A,
    clock: seq,
    seq,
    deps: {},
    timestamp: 1_700_000_000_000 + seq * 60_000,
    ops: [{ kind: 'node.add', target: `n${seq}`, content: '' }],
  } as unknown as Batch,
  cut: { [A]: seq },
});

const commitOf = (id: string) => ({
  id: id as CommitId,
  message: id,
  at: 1,
  authorActor: A,
  kind: COMMIT_KIND.COMMIT,
});

const branch: BranchMeta = {
  id: B1,
  name: 'b1',
  base: commitOf('base'),
  status: BRANCH_STATUS.OPEN,
  sheetId: 's' as SheetId,
  trunkFileId: 'f' as FileId,
  branchFileId: 'g' as FileId,
};

const lanes: TimelineLane[] = [
  {
    branchId: null,
    name: 'trunk',
    status: null,
    entries: [
      { kind: 'changes', points: [change(1), change(2)] },
      {
        kind: 'operation',
        point: {
          kind: 'branch',
          branch,
          cut: { [A]: 2 },
          timestamp: 0,
          touched: NONE(),
        },
      },
    ],
  },
  {
    branchId: B1,
    name: 'b1',
    status: BRANCH_STATUS.OPEN,
    entries: [
      {
        kind: 'operation',
        point: {
          kind: 'commit',
          commit: commitOf('最初の commit'),
          cut: { [A]: 3 },
          timestamp: 0,
          touched: NONE(),
        },
      },
    ],
  },
];

function renderTree(
  currentLane: BranchId | null = null,
  selected: TimelineSelection | null = null,
) {
  const onSelect = mock(() => {});
  render(
    <VersionTree
      lanes={lanes}
      currentLane={currentLane}
      selected={selected}
      onSelect={onSelect}
      labelOfActor={() => 'alice'}
      renderDetail={(selection) => (
        <p>
          詳細:{' '}
          {selection.kind === 'change' ? selection.point.batch.id : 'operation'}
        </p>
      )}
    />,
  );
  return onSelect;
}

describe('VersionTree (#73 T3)', () => {
  test('branch の線は、その分岐の点の直下に出る', () => {
    renderTree();
    const tree = screen.getByRole('region', { name: 'version tree' });
    const text = tree.textContent ?? '';
    expect(text.indexOf('branch b1')).toBeLessThan(
      text.indexOf('最初の commit'),
    );
    expect(screen.getByRole('region', { name: 'b1 の線' })).toBeTruthy();
  });

  test('change point の続きは「N 件の変更」に畳み、押すと広げる', () => {
    renderTree();
    const run = screen.getByRole('button', { name: '2 件の変更' });
    expect(run.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryAllByText(/alice/)).toHaveLength(0);
    fireEvent.click(run);
    expect(run.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByText(/alice/)).toHaveLength(2);
  });

  test('点を押すと、その点と線を選ぶ', () => {
    const onSelect = renderTree();
    fireEvent.click(screen.getByRole('button', { name: '最初の commit' }));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'operation', lane: B1 }),
    );
  });

  test('見ている線の名前を太字にする', () => {
    renderTree(B1);
    expect(screen.getByText('b1').style.fontWeight).toBe('bold');
    expect(screen.getByText('trunk').style.fontWeight).toBe('normal');
  });

  test('選んだ点の直下に詳細を出す (1 つだけ)', () => {
    const firstRun = lanes[0]?.entries[0];
    const second =
      firstRun?.kind === 'changes' ? firstRun.points[1] : undefined;
    if (!second) throw new Error('筋書きの change point が無い');
    renderTree(null, { kind: 'change', point: second, lane: null });
    fireEvent.click(screen.getByRole('button', { name: '2 件の変更' }));
    const rows = screen
      .getByRole('region', { name: 'trunk の線' })
      .querySelectorAll('li');
    const texts = [...rows].map((li) => li.textContent ?? '');
    const at = texts.indexOf('詳細: batch-2');
    expect(at).toBeGreaterThan(0);
    // 直前の行は選んだ点 (2 つ目の変更)、直後は分岐の点
    expect(texts[at - 1]).toContain('alice');
    expect(screen.getAllByText(/^詳細:/)).toHaveLength(1);
  });
});
