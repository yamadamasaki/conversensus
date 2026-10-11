import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import type { Sheet, SheetId } from '../schemas';
import { templateFromSheet, templateIdOf } from './fromSheet';
import { SEED_PLACEMENTS, SEED_TEMPLATES } from './registry';
import { templateGraphOf } from './seed';
import { TOULMIN_PLACEMENT, TOULMIN_TEMPLATE } from './toulmin';
import { ANY_NODE_KIND, type Template, TemplateSchema } from './types';

const SHEET = '00000000-0000-4000-8000-0000000000a1' as SheetId;

/** 連番の uuid。往復の比較は id ではなく名前で行うので、何でもよい */
function idSource() {
  let n = 0;
  return () => `00000000-0000-4000-8000-${(++n).toString().padStart(12, '0')}`;
}

/** 種 → template graph → 読み替え */
function roundTrip(template: Template): Template {
  const content = templateGraphOf(template, idSource());
  const sheet: Sheet = { id: SHEET, name: template.name, ...content };
  return templateFromSheet(sheet, templateIdOf(SHEET));
}

/**
 * 種類を id に依らない形にする。node の種類は (名前, 説明, 既定値)、edge の種類は
 * (名前, 端の種類の名前, 既定値)。往復で id は変わるので、名前で比べる
 */
function shape(t: Template) {
  const nameOf = (id: string) =>
    id === ANY_NODE_KIND
      ? '*'
      : (t.nodeKinds.find((k) => k.id === id)?.label ?? '?');
  return {
    nodes: t.nodeKinds
      .map((k) => JSON.stringify([k.label, k.description ?? '', k.defaults]))
      .sort(),
    edges: t.edgeKinds
      .flatMap((k) =>
        k.from.flatMap((f) =>
          k.to.map((to) =>
            JSON.stringify([k.label, nameOf(f), nameOf(to), k.defaults]),
          ),
        ),
      )
      .sort(),
  };
}

/**
 * 種の生成器。node の種類の名前は**重ならない**ように引く — 往復は名前で比べるので、同じ名前の
 * 種類が 2 つあると区別できない (template graph でも同じ名前の node は 2 つの種類になる)
 */
const arbTemplate: fc.Arbitrary<Template> = fc
  .record({
    kinds: fc.uniqueArray(fc.constantFrom('主張', 'データ', '論拠', '反論'), {
      minLength: 1,
      maxLength: 4,
    }),
    edges: fc.array(
      fc.record({
        from: fc.nat({ max: 4 }),
        to: fc.nat({ max: 4 }),
        label: fc.constantFrom('', '支える', '切り崩す'),
        withDefault: fc.boolean(),
      }),
      { maxLength: 5 },
    ),
  })
  .map(({ kinds, edges }) => {
    // 端の番号が種類の数以上なら「任意」にする (任意の端を引くため)
    const end = (i: number) => (i < kinds.length ? `k${i}` : ANY_NODE_KIND);
    return TemplateSchema.parse({
      id: 'template.seed',
      name: '種',
      nodeKinds: kinds.map((label, i) => ({
        id: `k${i}`,
        label,
        ...(i % 2 === 0 && { description: `${label} の説明` }),
      })),
      // 両端とも任意の edge は種類にならない (template graph の説明書きと同じ) ので引かない
      edgeKinds: edges
        .filter(
          (e) => end(e.from) !== ANY_NODE_KIND || end(e.to) !== ANY_NODE_KIND,
        )
        .map((e, i) => ({
          id: `e${i}`,
          label: e.label,
          from: [end(e.from)],
          to: [end(e.to)],
          ...(e.withDefault && {
            properties: ['weight'],
            defaults: { weight: 1 },
          }),
        })),
    });
  });

describe('templateGraphOf: 性質', () => {
  test('種 → template graph → 読み替え で、同じ種類に戻る (名前・説明・端・既定値)', () => {
    fc.assert(
      fc.property(arbTemplate, (template) => {
        expect(shape(roundTrip(template))).toEqual(shape(template));
      }),
    );
  });
});

describe('templateGraphOf: 例', () => {
  test('Toulmin model は往復して同じ種類に戻る', () => {
    expect(shape(roundTrip(TOULMIN_TEMPLATE))).toEqual(shape(TOULMIN_TEMPLATE));
  });

  test('「任意」の端を持つ種類があると、label の無い node を 1 つだけ置く', () => {
    const t = TemplateSchema.parse({
      id: 'template.any',
      name: 'T',
      nodeKinds: [{ id: 'claim', label: '主張' }],
      edgeKinds: [
        { id: 'a', label: '補足', from: [ANY_NODE_KIND], to: ['claim'] },
        { id: 'b', label: '参照', from: ['claim'], to: [ANY_NODE_KIND] },
      ],
    });
    const { nodes } = templateGraphOf(t, idSource());
    expect(nodes.filter((n) => !n.label)).toHaveLength(1);
  });

  test('すべての種は schema を通る template graph になる (置き場所は重ならない)', () => {
    for (const seed of SEED_TEMPLATES) {
      const { layouts } = templateGraphOf(
        seed,
        idSource(),
        SEED_PLACEMENTS[seed.id],
      );
      const spots = new Set(layouts.map((l) => `${l.x},${l.y}`));
      expect(spots.size).toBe(layouts.length);
    }
  });
});

/** node の既定の大きさ (`seed.ts` の格子と同じ前提) */
const NODE_W = 160;
const NODE_H = 80;
/** edge の label どうしが離れているべき距離 (#256) */
const LABEL_MIN_DISTANCE = 120;

describe('templateGraphOf: 並べ方 (#256)', () => {
  test('並べ方を渡すと、その種類の node はそこに置かれる', () => {
    const { nodes, layouts } = templateGraphOf(
      TOULMIN_TEMPLATE,
      idSource(),
      TOULMIN_PLACEMENT,
    );
    const claim = nodes.find((n) => n.label === '主張');
    expect(layouts.find((l) => l.nodeId === claim?.id)).toMatchObject(
      TOULMIN_PLACEMENT.claim ?? {},
    );
  });

  test('Toulmin の edge の中点どうしは離れていて、node の中に入らない', () => {
    const { edges, layouts } = templateGraphOf(
      TOULMIN_TEMPLATE,
      idSource(),
      TOULMIN_PLACEMENT,
    );
    const at = new Map(layouts.map((l) => [l.nodeId as string, l]));
    const center = (id: string) => {
      const l = at.get(id);
      if (!l) throw new Error(`layout が無い: ${id}`);
      return { x: (l.x ?? 0) + NODE_W / 2, y: (l.y ?? 0) + NODE_H / 2 };
    };
    // label は edge のおよそ中点に出る。中心どうしの中点で近似する
    const mids = edges.map((e) => {
      const s = center(e.source);
      const t = center(e.target);
      return { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 };
    });
    for (const [i, a] of mids.entries()) {
      for (const b of mids.slice(i + 1)) {
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(
          LABEL_MIN_DISTANCE,
        );
      }
      for (const { x = 0, y = 0 } of layouts) {
        const inside =
          a.x > x && a.x < x + NODE_W && a.y > y && a.y < y + NODE_H;
        expect(inside).toBe(false);
      }
    }
  });
});
