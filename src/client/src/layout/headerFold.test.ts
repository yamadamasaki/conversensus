import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  foldedAt,
  HEADER_FOLD_ORDER,
  iconsOnlyAt,
  MAX_FOLD_LEVEL,
  nextFoldLevel,
} from './headerFold';

const level = fc.integer({ min: 0, max: MAX_FOLD_LEVEL });

describe('headerFold (ヘッダの操作を畳む段)', () => {
  test('段 0 は何も畳まず、文字も出す。段 1 で記号だけにして PNG を畳む', () => {
    expect([...foldedAt(0)]).toEqual([]);
    expect(iconsOnlyAt(0)).toBe(false);
    expect([...foldedAt(1)]).toEqual(['png']);
    expect(iconsOnlyAt(1)).toBe(true);
  });

  test('上限の段ですべてを畳む。いつも使う操作 (undo など) は順に入っていない', () => {
    expect([...foldedAt(MAX_FOLD_LEVEL)]).toEqual([...HEADER_FOLD_ORDER]);
    expect(HEADER_FOLD_ORDER).not.toContain('undo' as never);
  });

  test('性質: 段を上げると、畳むものは増えるだけ (一度畳んだものが戻らない)', () => {
    fc.assert(
      fc.property(level, level, (a, b) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        const lower = foldedAt(low);
        const higher = foldedAt(high);
        for (const c of lower) expect(higher.has(c)).toBe(true);
      }),
    );
  });

  test('性質: 溢れていれば 1 つ上げ (上限で止まる)、溢れていなければ変えない', () => {
    fc.assert(
      fc.property(level, fc.boolean(), (l, overflowing) => {
        const next = nextFoldLevel(l, overflowing);
        if (!overflowing) expect(next).toBe(l);
        else expect(next).toBe(Math.min(l + 1, MAX_FOLD_LEVEL));
      }),
    );
  });
});
