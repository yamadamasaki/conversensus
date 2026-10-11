import { describe, expect, it } from 'bun:test';
import fc from 'fast-check';
import {
  compactHeader,
  MEDIUM_MIN_WIDTH,
  panelPresentation,
  tierOf,
  WIDE_MIN_WIDTH,
} from './viewportTier';

describe('tierOf', () => {
  it('境目は広い側に入る', () => {
    expect(tierOf(WIDE_MIN_WIDTH)).toBe('wide');
    expect(tierOf(WIDE_MIN_WIDTH - 1)).toBe('medium');
    expect(tierOf(MEDIUM_MIN_WIDTH)).toBe('medium');
    expect(tierOf(MEDIUM_MIN_WIDTH - 1)).toBe('narrow');
  });

  it('幅について単調である (広げて段が下がることはない)', () => {
    const rank = { narrow: 0, medium: 1, wide: 2 } as const;
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4000 }),
        fc.integer({ min: 0, max: 4000 }),
        (a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          return rank[tierOf(lo)] <= rank[tierOf(hi)];
        },
      ),
    );
  });
});

describe('panelPresentation (§9.2 の表)', () => {
  it('広い段は両方を並べ、開閉を覚える', () => {
    for (const side of ['left', 'right'] as const) {
      expect(panelPresentation('wide', side)).toEqual({
        mode: 'docked',
        remembersCollapse: true,
        dismissOnOutside: false,
      });
    }
  });

  it('中の段は左を並べ、右を重ねる。開閉は覚えない', () => {
    expect(panelPresentation('medium', 'left').mode).toBe('docked');
    expect(panelPresentation('medium', 'right').mode).toBe('overlay');
    expect(panelPresentation('medium', 'left').remembersCollapse).toBe(false);
    expect(panelPresentation('medium', 'right').remembersCollapse).toBe(false);
  });

  it('狭い段は両方を重ね、左だけが外側を押すと閉じる', () => {
    expect(panelPresentation('narrow', 'left')).toEqual({
      mode: 'overlay',
      remembersCollapse: false,
      dismissOnOutside: true,
    });
    expect(panelPresentation('narrow', 'right').dismissOnOutside).toBe(false);
  });
});

describe('compactHeader', () => {
  it('狭い段だけヘッダを記号だけにする', () => {
    expect(compactHeader('narrow')).toBe(true);
    expect(compactHeader('medium')).toBe(false);
    expect(compactHeader('wide')).toBe(false);
  });
});
