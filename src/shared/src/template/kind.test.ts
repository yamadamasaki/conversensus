import { describe, expect, test } from 'bun:test';
import { SYSTEM_PROPERTY_PREFIX } from '../events/properties';
import {
  edgeKindCandidates,
  hasTemplateKind,
  isKindProperty,
  isTemplateEdge,
  kindIdIn,
  kindPropertyOf,
  nodeKindIn,
} from './kind';
import { TOULMIN_TEMPLATE } from './toulmin';
import { TemplateSchema } from './types';

const KIND = kindPropertyOf(TOULMIN_TEMPLATE.id);
/** その種別を持つノードの properties */
const asKind = (id: string) => ({ [KIND]: id });

describe('kindPropertyOf', () => {
  test('template の id から名前空間ごと導く — 拡張の規約に従う', () => {
    expect(KIND).toBe('jp.co.metabolics.toulmin.kind');
  });

  test('system (app.conversensus.*) ではない — template は本体ではなく拡張である', () => {
    expect(KIND.startsWith(SYSTEM_PROPERTY_PREFIX)).toBe(false);
  });

  test('custom にも見えない — `.` を含むことが判定規則そのものである', () => {
    expect(KIND).toContain('.');
  });

  test('template が違えば別のプロパティになる (同時に持てる)', () => {
    const other = TemplateSchema.parse({
      id: 'com.example.other',
      name: 'other',
      nodeKinds: [{ id: 'claim', label: '言い分' }],
      edgeKinds: [],
    });
    expect(kindPropertyOf(other.id)).not.toBe(KIND);
  });
});

describe('kindIdIn / nodeKindIn', () => {
  test('その template の種別 id を読む', () => {
    expect(String(kindIdIn(TOULMIN_TEMPLATE, asKind('claim')))).toBe('claim');
    expect(nodeKindIn(TOULMIN_TEMPLATE, asKind('claim'))?.label).toBe('主張');
  });

  test('プロパティが無ければ undefined (= その template の要素ではない)', () => {
    expect(kindIdIn(TOULMIN_TEMPLATE, undefined)).toBeUndefined();
    expect(kindIdIn(TOULMIN_TEMPLATE, {})).toBeUndefined();
    expect(kindIdIn(TOULMIN_TEMPLATE, { 期限: '明日' })).toBeUndefined();
  });

  test('別の template のプロパティは読まない', () => {
    expect(
      kindIdIn(TOULMIN_TEMPLATE, { 'com.example.other.kind': 'claim' }),
    ).toBeUndefined();
  });

  test('その template に無い id は種別なしとして読む', () => {
    expect(kindIdIn(TOULMIN_TEMPLATE, asKind('unknown'))).toBeUndefined();
  });

  test('文字列でない値・空文字は種別なし (他人の書いたログを信用しない)', () => {
    expect(kindIdIn(TOULMIN_TEMPLATE, { [KIND]: '' })).toBeUndefined();
    expect(kindIdIn(TOULMIN_TEMPLATE, { [KIND]: 42 })).toBeUndefined();
    expect(kindIdIn(TOULMIN_TEMPLATE, { [KIND]: null })).toBeUndefined();
  });

  test('1 つの node が複数の template の種別を同時に持てる', () => {
    const other = TemplateSchema.parse({
      id: 'com.example.other',
      name: 'other',
      nodeKinds: [{ id: 'question', label: '問い' }],
      edgeKinds: [],
    });
    const props = {
      [KIND]: 'claim',
      [kindPropertyOf(other.id)]: 'question',
    };
    expect(nodeKindIn(TOULMIN_TEMPLATE, props)?.label).toBe('主張');
    expect(nodeKindIn(other, props)?.label).toBe('問い');
  });
});

describe('edgeKindCandidates', () => {
  test('許される組は候補 1 — 自動で決まる', () => {
    expect(
      edgeKindCandidates(
        [TOULMIN_TEMPLATE],
        asKind('data'),
        asKind('claim'),
      ).map((r) => r.kind.label),
    ).toEqual(['支える']);
  });

  test('許されない組は候補 0 — 繋げない', () => {
    expect(
      edgeKindCandidates([TOULMIN_TEMPLATE], asKind('claim'), asKind('data')),
    ).toEqual([]);
  });

  test('toulmin では候補が 2 以上にならない (5x5 のうち 5 組が全て候補 1)', () => {
    const ids = TOULMIN_TEMPLATE.nodeKinds.map((k) => k.id);
    const counts = ids.flatMap((f) =>
      ids.map(
        (t) =>
          edgeKindCandidates([TOULMIN_TEMPLATE], asKind(f), asKind(t)).length,
      ),
    );
    expect(counts.filter((n) => n === 1)).toHaveLength(5);
    expect(counts.filter((n) => n > 1)).toHaveLength(0);
  });

  test('候補が複数になる template では複数返す (step3 の道を塞がない)', () => {
    const ambiguous = TemplateSchema.parse({
      id: 'com.example.ambiguous',
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
    const kp = kindPropertyOf(ambiguous.id);
    expect(
      edgeKindCandidates([ambiguous], { [kp]: 'a' }, { [kp]: 'b' }).map(
        (r) => r.kind.label,
      ),
    ).toEqual(['支持', '反対']);
  });

  test('端点に種別が無ければ候補は空', () => {
    expect(
      edgeKindCandidates([TOULMIN_TEMPLATE], undefined, asKind('claim')),
    ).toEqual([]);
  });

  test('判定は template ごとに閉じる — 混ぜて引かない', () => {
    const t1 = TemplateSchema.parse({
      id: 'com.example.t1',
      name: 't1',
      nodeKinds: [{ id: 'x', label: 'X' }],
      edgeKinds: [{ id: 'e', label: '繋ぐ', from: ['x'], to: ['x'] }],
    });
    const t2 = TemplateSchema.parse({
      id: 'com.example.t2',
      name: 't2',
      nodeKinds: [{ id: 'x', label: 'X2' }],
      edgeKinds: [],
    });
    // from は t1 の x、to は t2 の x。同じ id だが別の template なので規則は効かない
    expect(
      edgeKindCandidates(
        [t1, t2],
        { [kindPropertyOf(t1.id)]: 'x' },
        { [kindPropertyOf(t2.id)]: 'x' },
      ),
    ).toEqual([]);
  });
});

describe('isKindProperty / hasTemplateKind', () => {
  test('種別プロパティを名前だけで見分ける', () => {
    expect(isKindProperty(kindPropertyOf(TOULMIN_TEMPLATE.id))).toBe(true);
    expect(isKindProperty('com.example.other.kind')).toBe(true);
  });

  test('custom は当たらない — `.` を含まない名前は編集者のものである', () => {
    expect(isKindProperty('kind')).toBe(false);
    expect(isKindProperty('期限')).toBe(false);
  });

  test('種別以外の拡張プロパティも当たらない', () => {
    expect(isKindProperty('com.example.other.weight')).toBe(false);
  });

  test('hasTemplateKind は template を特定せずに判定する', () => {
    // 「ラベルを編集させるか」のように template を知る必要が無い問いに使う
    expect(hasTemplateKind(asKind('claim'))).toBe(true);
    expect(hasTemplateKind({ 'com.example.unknown.kind': 'x' })).toBe(true);
    expect(hasTemplateKind({ 期限: '明日' })).toBe(false);
    expect(hasTemplateKind(undefined)).toBe(false);
  });
});

describe('isTemplateEdge', () => {
  test('両端が同じ template の種別を持つときだけ規則に従う', () => {
    expect(
      isTemplateEdge([TOULMIN_TEMPLATE], asKind('data'), asKind('claim')),
    ).toBe(true);
    expect(isTemplateEdge([TOULMIN_TEMPLATE], asKind('data'), undefined)).toBe(
      false,
    );
    expect(isTemplateEdge([TOULMIN_TEMPLATE], undefined, undefined)).toBe(
      false,
    );
  });

  test('候補 0 と「制約の対象外」は別物である', () => {
    // どちらも edgeKindCandidates は空だが、意味が違う
    const bad = [asKind('claim'), asKind('data')] as const;
    expect(edgeKindCandidates([TOULMIN_TEMPLATE], ...bad)).toEqual([]);
    expect(isTemplateEdge([TOULMIN_TEMPLATE], ...bad)).toBe(true); // 繋げない

    const free = [asKind('claim'), undefined] as const;
    expect(edgeKindCandidates([TOULMIN_TEMPLATE], ...free)).toEqual([]);
    expect(isTemplateEdge([TOULMIN_TEMPLATE], ...free)).toBe(false); // 自由
  });
});
