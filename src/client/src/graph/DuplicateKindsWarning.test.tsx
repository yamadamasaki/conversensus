import { afterEach, describe, expect, test } from 'bun:test';
import type { GraphNode, NodeId } from '@conversensus/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { DuplicateKindsWarning } from './DuplicateKindsWarning';

afterEach(cleanup);

const node = (n: number, label?: string): GraphNode => ({
  id: `00000000-0000-4000-8000-00000000000${n}` as NodeId,
  content: '',
  ...(label !== undefined && { label }),
});

describe('DuplicateKindsWarning (template-update K6)', () => {
  test('名前の重なった種類を、名前を挙げて知らせる', () => {
    render(
      <DuplicateKindsWarning
        sheet={{
          nodes: [node(1, '主張'), node(2, '主張'), node(3, 'データ')],
        }}
      />,
    );
    const text = screen.getByRole('status').textContent ?? '';
    expect(text).toContain('「主張」');
    expect(text).not.toContain('「データ」');
  });

  test('重なりが無ければ何も出さない (label の無い node がいくつあっても)', () => {
    const { container } = render(
      <DuplicateKindsWarning
        sheet={{ nodes: [node(1, '主張'), node(2), node(3)] }}
      />,
    );
    expect(container.innerHTML).toBe('');
  });
});
