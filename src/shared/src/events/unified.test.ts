import { describe, expect, test } from 'bun:test';
import {
  BatchSchema,
  FILE_OP_KINDS,
  isContentOp,
  isFileOp,
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

  test('file カテゴリ op は同期対象 (§3.2)', () => {
    expect(opCategory({ kind: 'file.setName', name: 'F' })).toBe('file');
    expect(isSyncable({ kind: 'file.setName', name: 'F' })).toBe(true);
    expect(
      isSyncable({ kind: 'sheet.create', target: 'x' as never, name: 'S' }),
    ).toBe(true);
  });
});

describe('isFileOp', () => {
  test('FILE_OP_KINDS の op のみ file と判定する', () => {
    expect(isFileOp({ kind: 'file.setName', name: 'F' })).toBe(true);
    expect(isFileOp({ kind: 'sheet.remove', target: 'x' as never })).toBe(true);
    expect(
      isFileOp({ kind: 'node.add', target: 'x' as never, content: 'A' }),
    ).toBe(false);
  });

  test('FILE_OP_KINDS は OP_CATEGORY で file に揃っている', () => {
    for (const kind of FILE_OP_KINDS) {
      expect(OP_CATEGORY[kind]).toBe('file');
    }
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

  test('seed は下限を取り込むが +1 しない (次の tick が floor+1)', () => {
    const c = new LamportClock();
    expect(c.seed(7)).toBe(7); // observe と違い +1 しない
    expect(c.tick()).toBe(8);
  });

  test('seed は現在値より小さい floor を無視する (単調性を保つ)', () => {
    const c = new LamportClock(10);
    expect(c.seed(4)).toBe(10);
    expect(c.tick()).toBe(11);
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

  test('sheetId は optional で、指定すれば受理する (§3.1)', () => {
    const result = BatchSchema.safeParse({
      id: crypto.randomUUID(),
      actor: 'local',
      clock: 1,
      timestamp: Date.now(),
      sheetId: crypto.randomUUID(),
      ops: [{ kind: 'node.add', target: crypto.randomUUID(), content: 'A' }],
    });
    expect(result.success).toBe(true);
  });
});

describe('node.setLabel (Phase 5 P1)', () => {
  const setLabel = {
    kind: 'node.setLabel',
    target: crypto.randomUUID() as never,
    label: '主張',
  } as const;

  test('content カテゴリに属する — edge.setLabel と揃える (設計 D4)', () => {
    // 人が決めた意味であって位置でも構造でもない。layout に置くと通知だけで流れ、
    // structure に置くと削除依存の判定に混ざる
    expect(OP_CATEGORY['node.setLabel']).toBe('content');
    expect(OP_CATEGORY['node.setLabel']).toBe(OP_CATEGORY['edge.setLabel']);
  });

  test('content op なので同期され、対立検出の対象になる', () => {
    expect(isContentOp(setLabel)).toBe(true);
    expect(isSyncable(setLabel)).toBe(true);
  });
});
