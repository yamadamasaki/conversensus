import { describe, expect, test } from 'bun:test';
import { SYSTEM_PROPERTY_PREFIX } from '../events/properties';
import {
  edgeKindsBetween,
  isTemplateEdge,
  KIND_PROPERTY,
  kindIdOf,
  nodeKindById,
} from './kind';
import { TOULMIN_TEMPLATE } from './toulmin';
import { type NodeKindId, NodeKindIdSchema, TemplateSchema } from './types';

const kid = (s: string): NodeKindId => NodeKindIdSchema.parse(s);
const CLAIM = kid('claim');
const DATA = kid('data');
const WARRANT = kid('warrant');

describe('KIND_PROPERTY', () => {
  test('システム接頭辞を持つ — 編集者の名前空間を侵さない', () => {
    expect(KIND_PROPERTY).toBe(`${SYSTEM_PROPERTY_PREFIX}kind`);
    // `.` を含むことが「編集者のものではない」の判定規則そのものである
    expect(KIND_PROPERTY).toContain('.');
  });
});

describe('kindIdOf', () => {
  test('property から種別 id を読む', () => {
    expect(kindIdOf({ [KIND_PROPERTY]: 'claim' })).toBe(CLAIM);
  });

  test('property が無い / kind が無いなら undefined (= template の要素ではない)', () => {
    expect(kindIdOf(undefined)).toBeUndefined();
    expect(kindIdOf({})).toBeUndefined();
    expect(kindIdOf({ 期限: '明日' })).toBeUndefined();
  });

  test('空文字は種別なしとして読む', () => {
    expect(kindIdOf({ [KIND_PROPERTY]: '' })).toBeUndefined();
  });

  test('文字列でない値は種別なしとして読む (他人の書いたログを信用しない)', () => {
    expect(kindIdOf({ [KIND_PROPERTY]: 42 })).toBeUndefined();
    expect(kindIdOf({ [KIND_PROPERTY]: null })).toBeUndefined();
  });
});

describe('nodeKindById', () => {
  test('id から種別を引く', () => {
    expect(nodeKindById([TOULMIN_TEMPLATE], CLAIM)?.label).toBe('主張');
  });

  test('知らない id / 未指定は undefined', () => {
    expect(nodeKindById([TOULMIN_TEMPLATE], kid('unknown'))).toBeUndefined();
    expect(nodeKindById([TOULMIN_TEMPLATE], undefined)).toBeUndefined();
  });

  test('同じ id を持つ template が 2 つあれば先勝ち (種別一覧と同じ規則)', () => {
    const other = TemplateSchema.parse({
      id: 'other',
      name: 'other',
      nodeKinds: [{ id: 'claim', label: '言い分' }],
      edgeKinds: [],
    });
    expect(nodeKindById([TOULMIN_TEMPLATE, other], CLAIM)?.label).toBe('主張');
    expect(nodeKindById([other, TOULMIN_TEMPLATE], CLAIM)?.label).toBe(
      '言い分',
    );
  });
});

describe('edgeKindsBetween', () => {
  test('許される組は候補 1 — 自動で決まる', () => {
    const ks = edgeKindsBetween([TOULMIN_TEMPLATE], DATA, CLAIM);
    expect(ks.map((k) => k.label)).toEqual(['支える']);
  });

  test('許されない組は候補 0 — 繋げない', () => {
    expect(edgeKindsBetween([TOULMIN_TEMPLATE], CLAIM, DATA)).toEqual([]);
    expect(edgeKindsBetween([TOULMIN_TEMPLATE], DATA, WARRANT)).toEqual([]);
  });

  test('toulmin では候補が 2 以上にならない (5x5 のうち 5 組が全て候補 1)', () => {
    const ids = TOULMIN_TEMPLATE.nodeKinds.map((k) => k.id);
    const counts = ids.flatMap((f) =>
      ids.map((t) => edgeKindsBetween([TOULMIN_TEMPLATE], f, t).length),
    );
    expect(counts.filter((n) => n === 1)).toHaveLength(5);
    expect(counts.filter((n) => n > 1)).toHaveLength(0);
  });

  test('候補が複数になる template では複数返す (step3 の道を塞がない)', () => {
    const ambiguous = TemplateSchema.parse({
      id: 'ambiguous',
      name: 'ambiguous',
      nodeKinds: [
        { id: 'a', label: 'あ' },
        { id: 'b', label: 'い' },
      ],
      edgeKinds: [
        { id: 'e1', label: '支持', from: ['a'], to: ['b'] },
        { id: 'e2', label: '反対', from: ['a'], to: ['b'] },
      ],
    });
    expect(
      edgeKindsBetween([ambiguous], kid('a'), kid('b')).map((k) => k.label),
    ).toEqual(['支持', '反対']);
  });

  test('端点に種別が無ければ候補は空 (制約の対象外と区別するのは isTemplateEdge)', () => {
    expect(edgeKindsBetween([TOULMIN_TEMPLATE], undefined, CLAIM)).toEqual([]);
    expect(edgeKindsBetween([TOULMIN_TEMPLATE], DATA, undefined)).toEqual([]);
  });

  test('解決は template ごと — 和の上で混線させない', () => {
    const t1 = TemplateSchema.parse({
      id: 't1',
      name: 't1',
      nodeKinds: [{ id: 'x', label: 'X1' }],
      edgeKinds: [{ id: 'e', label: '繋ぐ', from: ['x'], to: ['x'] }],
    });
    const t2 = TemplateSchema.parse({
      id: 't2',
      name: 't2',
      nodeKinds: [{ id: 'y', label: 'Y2' }],
      edgeKinds: [],
    });
    // x は t1 に、y は t2 にしかない。t1 の規則を t2 の種別で満たしてはならない
    expect(edgeKindsBetween([t1, t2], kid('x'), kid('y'))).toEqual([]);
  });
});

describe('isTemplateEdge', () => {
  test('両端とも種別を持つときだけ template の規則に従う', () => {
    expect(isTemplateEdge(DATA, CLAIM)).toBe(true);
    expect(isTemplateEdge(DATA, undefined)).toBe(false);
    expect(isTemplateEdge(undefined, undefined)).toBe(false);
  });

  test('候補 0 と「制約の対象外」は別物である', () => {
    // どちらも edgeKindsBetween は空だが、意味が違う
    expect(edgeKindsBetween([TOULMIN_TEMPLATE], CLAIM, DATA)).toEqual([]);
    expect(isTemplateEdge(CLAIM, DATA)).toBe(true); // 繋げない

    expect(edgeKindsBetween([TOULMIN_TEMPLATE], CLAIM, undefined)).toEqual([]);
    expect(isTemplateEdge(CLAIM, undefined)).toBe(false); // 自由に繋げる
  });
});
