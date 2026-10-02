import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  clampWidth,
  DEFAULT_SIDE_PANELS,
  MAX_PANEL_WIDTH,
  MIN_PANEL_WIDTH,
  parseSidePanels,
  resizedWidth,
  type SidePanelsState,
  serializeSidePanels,
} from './sidePanels';

/** 幅は範囲の内外と境界の両方を引く。範囲の中だけだと、収める規則を試さない */
const arbWidth = fc.oneof(
  fc.integer({ min: -100, max: 1000 }),
  fc.constantFrom(MIN_PANEL_WIDTH, MAX_PANEL_WIDTH),
);
const arbPanels: fc.Arbitrary<SidePanelsState> = fc.record({
  left: fc.record({ width: arbWidth, collapsed: fc.boolean() }),
  right: fc.record({ width: arbWidth, collapsed: fc.boolean() }),
});

describe('サイドバーの幅と開閉: 性質', () => {
  test('ドラッグでどれだけ引いても、幅は許す範囲の整数に収まる', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('left' as const, 'right' as const),
        arbWidth,
        fc.double({ min: -2000, max: 2000, noNaN: true }),
        (side, start, dx) => {
          const width = resizedWidth(side, start, dx);
          expect(Number.isInteger(width)).toBe(true);
          expect(width).toBeGreaterThanOrEqual(MIN_PANEL_WIDTH);
          expect(width).toBeLessThanOrEqual(MAX_PANEL_WIDTH);
        },
      ),
    );
  });

  test('範囲の中では、左は右へ・右は左へ引いた分だけ広がる', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MIN_PANEL_WIDTH, max: MAX_PANEL_WIDTH }),
        fc.integer({ min: -50, max: 50 }),
        (start, dx) => {
          const inside = (w: number) =>
            w >= MIN_PANEL_WIDTH && w <= MAX_PANEL_WIDTH;
          if (inside(start + dx))
            expect(resizedWidth('left', start, dx)).toBe(start + dx);
          if (inside(start - dx))
            expect(resizedWidth('right', start, dx)).toBe(start - dx);
        },
      ),
    );
  });

  test('保存して読み戻すと、幅を範囲に収めた同じ状態になる', () => {
    fc.assert(
      fc.property(arbPanels, (state) => {
        expect(parseSidePanels(serializeSidePanels(state))).toEqual({
          left: { ...state.left, width: clampWidth(state.left.width) },
          right: { ...state.right, width: clampWidth(state.right.width) },
        });
      }),
    );
  });
});

describe('サイドバーの幅と開閉: 例', () => {
  test('無い・JSON でない値は既定になる。既定の右サイドバーは畳んである', () => {
    expect(parseSidePanels(null)).toEqual(DEFAULT_SIDE_PANELS);
    expect(parseSidePanels('{')).toEqual(DEFAULT_SIDE_PANELS);
    expect(DEFAULT_SIDE_PANELS.right.collapsed).toBe(true);
  });

  test('片側が壊れていても、もう片側は残す', () => {
    const raw = JSON.stringify({
      left: { width: 300, collapsed: true },
      right: { width: 'wide' },
    });
    expect(parseSidePanels(raw)).toEqual({
      left: { width: 300, collapsed: true },
      right: DEFAULT_SIDE_PANELS.right,
    });
  });

  test('数でない幅は最小に収める', () => {
    expect(clampWidth(Number.NaN)).toBe(MIN_PANEL_WIDTH);
  });
});
