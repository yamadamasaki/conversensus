import { describe, expect, test } from 'bun:test';
import {
  BatchSchema,
  isSyncable,
  LamportClock,
  OP_CATEGORY,
  OpSchema,
  opCategory,
} from './unified';

describe('OP_CATEGORY', () => {
  test('全ての op kind にカテゴリが割り当てられている (追加漏れ検出)', () => {
    // OpSchema の各選択肢の kind リテラルを列挙する
    const kinds = OpSchema.options.map(
      (opt) => opt.shape.kind.value as keyof typeof OP_CATEGORY,
    );
    for (const kind of kinds) {
      expect(OP_CATEGORY[kind]).toBeDefined();
    }
    // 逆に、余分なカテゴリ定義がない
    expect(Object.keys(OP_CATEGORY).sort()).toEqual([...kinds].sort());
  });

  test('presentation のみローカル限定、他は同期対象 (D7)', () => {
    expect(
      isSyncable({ kind: 'node.setStyle', target: 'x' as never, style: {} }),
    ).toBe(false);
    expect(
      isSyncable({
        kind: 'node.setLayout',
        target: 'x' as never,
        x: 1,
      }),
    ).toBe(true);
    expect(opCategory({ kind: 'node.setLayout', target: 'x' as never })).toBe(
      'layout',
    );
  });
});

describe('LamportClock', () => {
  test('tick は単調増加する', () => {
    const c = new LamportClock();
    expect(c.tick()).toBe(1);
    expect(c.tick()).toBe(2);
  });

  test('observe はリモート時刻に追随する (max + 1)', () => {
    const c = new LamportClock(3);
    expect(c.observe(10)).toBe(11);
    expect(c.tick()).toBe(12);
    expect(c.observe(5)).toBe(13); // 自身の方が大きい場合も +1
  });
});

describe('BatchSchema', () => {
  test('ops が空の Batch は拒否する', () => {
    const result = BatchSchema.safeParse({
      id: crypto.randomUUID(),
      actor: 'local',
      clock: 0,
      timestamp: 0,
      ops: [],
    });
    expect(result.success).toBe(false);
  });

  test('妥当な Batch を受理する', () => {
    const result = BatchSchema.safeParse({
      id: crypto.randomUUID(),
      actor: 'local',
      clock: 1,
      timestamp: Date.now(),
      ops: [{ kind: 'node.add', target: crypto.randomUUID(), content: 'A' }],
    });
    expect(result.success).toBe(true);
  });
});
