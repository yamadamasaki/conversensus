import { afterEach, describe, expect, it, mock } from 'bun:test';
import {
  type EdgeKindRef,
  type Template,
  TemplateSchema,
} from '@conversensus/shared';

const { render, screen, fireEvent, cleanup } = await import(
  '@testing-library/react'
);
const { EdgeKindMenu } = await import('./EdgeKindMenu');

/** 同じ組 (データ → 主張) に 2 つの種類を持つ template と、別の template */
const ARGUMENT: Template = TemplateSchema.parse({
  id: 'template.a',
  name: '論証',
  nodeKinds: [
    { id: 'data', label: 'データ' },
    { id: 'claim', label: '主張' },
  ],
  edgeKinds: [
    { id: 'supports', label: '支える', from: ['data'], to: ['claim'] },
    { id: 'plain', label: '', from: ['data'], to: ['claim'] },
  ],
});
const OTHER: Template = TemplateSchema.parse({
  id: 'template.b',
  name: '因果',
  nodeKinds: [{ id: 'x', label: 'X' }],
  edgeKinds: [{ id: 'causes', label: '引き起こす', from: ['x'], to: ['x'] }],
});
const candidates: EdgeKindRef[] = [
  { templateId: ARGUMENT.id, kind: ARGUMENT.edgeKinds[0] as never },
  { templateId: ARGUMENT.id, kind: ARGUMENT.edgeKinds[1] as never },
  { templateId: OTHER.id, kind: OTHER.edgeKinds[0] as never },
];

afterEach(() => cleanup());

function renderMenu() {
  const onSelect = mock((_: EdgeKindRef | undefined) => {});
  render(
    <EdgeKindMenu
      position={{ x: 10, y: 10 }}
      candidates={candidates}
      templates={[ARGUMENT, OTHER]}
      onSelect={onSelect}
    />,
  );
  return onSelect;
}

describe('EdgeKindMenu (step3 Phase 4 Q8)', () => {
  it('候補を template ごとにまとめ、label の無い種類は「(名前なし)」と出す', () => {
    renderMenu();
    const texts = screen.getAllByRole('menuitem').map((b) => b.textContent);
    expect(texts).toEqual([
      '支える',
      '(名前なし)',
      '引き起こす',
      '種類なしで繋ぐ',
    ]);
    expect(screen.getByText('論証')).toBeTruthy();
    expect(screen.getByText('因果')).toBeTruthy();
  });

  it('選んだ種類を返す', () => {
    const onSelect = renderMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '支える' }));
    expect(onSelect.mock.calls[0]?.[0]?.kind.id).toBe('supports' as never);
  });

  it('「種類なしで繋ぐ」と Escape は、種類無し (undefined) を返す', () => {
    const onSelect = renderMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '種類なしで繋ぐ' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onSelect.mock.calls.map((c) => c[0])).toEqual([
      undefined,
      undefined,
    ]);
  });
});
