import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { CausalClock } from '../events/causalClock';
import { heldMaxima } from '../events/causality';
import { SHEET_KIND_PROPERTY, TEMPLATE_SHEET_KIND } from '../events/sheetKind';
import type { Actor, Batch, Op } from '../events/unified';
import {
  type EdgeId,
  type FileId,
  FileIdSchema,
  type GraphEdge,
  type GraphNode,
  type NodeId,
  type Sheet,
  type SheetId,
  SheetIdSchema,
} from '../schemas';
import {
  duplicateKindLabels,
  resolveTemplates,
  templateFromSheet,
  templateIdOf,
} from './fromSheet';
import { edgeKindCandidates, isTemplateEdge, kindPropertyOf } from './kind';
import { ANY_NODE_KIND, TemplateSchema } from './types';

const SHEET = SheetIdSchema.parse('00000000-0000-4000-8000-0000000000a1');
const TEMPLATE_ID = templateIdOf(SHEET);
const NODE_IDS = [1, 2, 3, 4].map(
  (n) => `00000000-0000-4000-8000-00000000000${n}` as NodeId,
);

/**
 * 小さな template graph の生成器。node は 4 つで、それぞれ label の有無を引く。edge はその間に
 * 引き、label の有無も引く。**小さなプール**にするのは、「label のある node とない node を繋ぐ
 * edge」「label のない node 同士の edge」「同じ組の edge が 2 本」に当たるため
 */
const arbTemplateSheet: fc.Arbitrary<Sheet> = fc
  .record({
    labels: fc.tuple(
      ...NODE_IDS.map(() => fc.constantFrom('', '主張', 'データ')),
    ),
    edges: fc.array(
      fc.record({
        source: fc.nat({ max: 3 }),
        target: fc.nat({ max: 3 }),
        label: fc.constantFrom('', '支える'),
        withDefault: fc.boolean(),
      }),
      { maxLength: 6 },
    ),
  })
  .map(({ labels, edges }) => {
    const nodes: GraphNode[] = NODE_IDS.map((id, i) => ({
      id,
      content: `説明 ${i}`,
      ...(labels[i] !== '' && { label: labels[i] }),
    }));
    const graphEdges: GraphEdge[] = edges.map((e, i) => ({
      id: `00000000-0000-4000-8000-0000000001${i.toString().padStart(2, '0')}` as EdgeId,
      source: NODE_IDS[e.source] as NodeId,
      target: NODE_IDS[e.target] as NodeId,
      ...(e.label !== '' && { label: e.label }),
      ...(e.withDefault && { properties: { weight: 1 } }),
    }));
    return { id: SHEET, name: 'T', nodes, edges: graphEdges };
  });

const labelAt = (sheet: Sheet, id: string) =>
  sheet.nodes.find((n) => n.id === id)?.label ?? '';
/** その label を持つ node の数 */
const holders = (sheet: Sheet, label: string) =>
  sheet.nodes.filter((n) => (n.label ?? '') === label).length;
/** 種類になる node: label があり、その label を持つ node が他に無い (K6) */
const isKind = (sheet: Sheet, id: string) =>
  labelAt(sheet, id) !== '' && holders(sheet, labelAt(sheet, id)) === 1;
/** 重複で無効になった node: label があり、同じ label の node が他にもある */
const isInvalid = (sheet: Sheet, id: string) =>
  labelAt(sheet, id) !== '' && holders(sheet, labelAt(sheet, id)) > 1;

describe('templateFromSheet: 性質', () => {
  test('label があり、その label が他の node と重ならない node ちょうどが node の種類になる (K6)', () => {
    fc.assert(
      fc.property(arbTemplateSheet, (sheet) => {
        const t = templateFromSheet(sheet, TEMPLATE_ID);
        expect(t.nodeKinds.map((k) => String(k.id)).sort()).toEqual(
          sheet.nodes
            .filter((n) => isKind(sheet, n.id))
            .map((n) => n.id)
            .sort(),
        );
      }),
    );
  });

  test('重複した label ちょうどが警告に出る', () => {
    fc.assert(
      fc.property(arbTemplateSheet, (sheet) => {
        const expected = [
          ...new Set(
            sheet.nodes
              .filter((n) => isInvalid(sheet, n.id))
              .map((n) => n.label as string),
          ),
        ].sort();
        expect(duplicateKindLabels(sheet)).toEqual(expected);
      }),
    );
  });

  test('少なくとも一方の端が種類で、どちらの端も重複で無効でない edge ちょうどが edge の種類になり、種類でない端は「任意」', () => {
    fc.assert(
      fc.property(arbTemplateSheet, (sheet) => {
        const t = templateFromSheet(sheet, TEMPLATE_ID);
        const expected = sheet.edges.filter(
          (e) =>
            (isKind(sheet, e.source) || isKind(sheet, e.target)) &&
            !isInvalid(sheet, e.source) &&
            !isInvalid(sheet, e.target),
        );
        expect(t.edgeKinds.map((k) => String(k.id)).sort()).toEqual(
          expected.map((e) => e.id).sort(),
        );
        for (const ek of t.edgeKinds) {
          const edge = sheet.edges.find(
            (e) => e.id === String(ek.id),
          ) as GraphEdge;
          expect(ek.from.map(String)).toEqual([
            isKind(sheet, edge.source) ? edge.source : ANY_NODE_KIND,
          ]);
          expect(ek.to.map(String)).toEqual([
            isKind(sheet, edge.target) ? edge.target : ANY_NODE_KIND,
          ]);
        }
      }),
    );
  });

  test('読み替えた結果は template の参照整合性を満たす (schema を通る)', () => {
    fc.assert(
      fc.property(arbTemplateSheet, (sheet) => {
        expect(
          TemplateSchema.safeParse(templateFromSheet(sheet, TEMPLATE_ID))
            .success,
        ).toBe(true);
      }),
    );
  });

  test('適用先で、edge の候補は「端の種類が合う edge の種類」ちょうど。種別の無い端は任意に当たり、両端とも無ければ候補も制約も無い', () => {
    fc.assert(
      fc.property(
        arbTemplateSheet,
        fc.option(fc.nat({ max: 3 })),
        fc.option(fc.nat({ max: 3 })),
        (sheet, fromIndex, toIndex) => {
          const t = templateFromSheet(sheet, TEMPLATE_ID);
          const prop = kindPropertyOf(t.id);
          // 適用先の node: 種類を持つ (template の種類になった node の id) か、持たない (null)
          const kindAt = (i: number | null) => {
            if (i === null) return undefined;
            const id = NODE_IDS[i] as string;
            return isKind(sheet, id) ? id : undefined;
          };
          const from = kindAt(fromIndex);
          const to = kindAt(toIndex);
          const props = (k: string | undefined) =>
            k ? { [prop]: k } : undefined;
          const got = edgeKindCandidates([t], props(from), props(to))
            .map((r) => r.kind.id)
            .sort();
          const end = (k: string | undefined) => k ?? ANY_NODE_KIND;
          const expected =
            from === undefined && to === undefined
              ? []
              : t.edgeKinds
                  .filter(
                    (ek) =>
                      ek.from.includes(end(from) as never) &&
                      ek.to.includes(end(to) as never),
                  )
                  .map((ek) => ek.id)
                  .sort();
          expect(got).toEqual(expected);
          // 制約 (繋げない組) が掛かるのは、両端とも種類を持つときだけ
          expect(isTemplateEdge([t], props(from), props(to))).toBe(
            from !== undefined && to !== undefined,
          );
        },
      ),
    );
  });
});

describe('templateFromSheet: 例', () => {
  const claim = NODE_IDS[0] as NodeId;
  const data = NODE_IDS[1] as NodeId;
  const note = NODE_IDS[2] as NodeId;
  const sheet: Sheet = {
    id: SHEET,
    name: 'Toulmin model',
    nodes: [
      {
        id: claim,
        content: '結論',
        label: '主張',
        properties: { owner: '', [kindPropertyOf(templateIdOf('other'))]: 'x' },
      },
      { id: data, content: '', label: 'データ' },
      { id: note, content: 'この template の使い方' },
    ],
    edges: [
      {
        id: 'e1' as EdgeId,
        source: data,
        target: claim,
        label: '支える',
        properties: { weight: 1 },
      },
      { id: 'e2' as EdgeId, source: note, target: claim, label: '補足' },
      { id: 'e3' as EdgeId, source: note, target: note },
    ],
  };

  test('表示名・説明・既定値 (種別プロパティは既定値に入れない)', () => {
    const t = templateFromSheet(sheet, TEMPLATE_ID);
    expect(t.name).toBe('Toulmin model');
    const claimKind = t.nodeKinds.find((k) => String(k.id) === claim);
    expect(claimKind?.label).toBe('主張');
    expect(claimKind?.description).toBe('結論');
    // prefix の無い名前は template の名前空間に入る (template-update K7)
    expect(claimKind?.defaults).toEqual({ [`${TEMPLATE_ID}.owner`]: '' });
    // 本文の無い node は説明を持たない
    expect(
      t.nodeKinds.find((k) => String(k.id) === data)?.description,
    ).toBeUndefined();
    const supports = t.edgeKinds.find((k) => k.id === 'e1');
    expect(supports?.properties).toEqual([`${TEMPLATE_ID}.weight`]);
    expect(supports?.defaults).toEqual({ [`${TEMPLATE_ID}.weight`]: 1 });
  });

  test('型・editable の宣言を読み、既定値には入れない。edge の持ちうる property には宣言だけのものも入る (K9)', () => {
    const t = templateFromSheet(
      {
        ...sheet,
        nodes: sheet.nodes.map((n) =>
          n.id === claim
            ? {
                ...n,
                properties: {
                  ...n.properties,
                  'app.conversensus.propertySchema.owner': { editable: false },
                },
              }
            : n,
        ),
        edges: sheet.edges.map((e) =>
          e.id === 'e1'
            ? {
                ...e,
                properties: {
                  ...e.properties,
                  'app.conversensus.propertySchema.weight': { type: 'number' },
                  'app.conversensus.propertySchema.期限': { type: 'date?' },
                },
              }
            : e,
        ),
      },
      TEMPLATE_ID,
    );
    const claimKind = t.nodeKinds.find((k) => String(k.id) === claim);
    const p = (name: string) => `${TEMPLATE_ID}.${name}`;
    expect(claimKind?.schema).toEqual({ [p('owner')]: { editable: false } });
    expect(claimKind?.defaults).toEqual({ [p('owner')]: '' });
    const supports = t.edgeKinds.find((k) => k.id === 'e1');
    // editable は既定で true
    expect(supports?.schema).toEqual({
      [p('weight')]: { type: 'number', editable: true },
      [p('期限')]: { type: 'date?', editable: true },
    });
    expect(supports?.defaults).toEqual({ [p('weight')]: 1 });
    expect(supports?.properties).toEqual([p('weight'), p('期限')]);
  });

  test('label の無い node 同士の edge は説明書き (種類にしない)。label のある node との edge は「任意」の端を持つ', () => {
    const t = templateFromSheet(sheet, TEMPLATE_ID);
    expect(t.edgeKinds.map((k) => String(k.id)).sort()).toEqual(['e1', 'e2']);
    expect(t.edgeKinds.find((k) => k.id === 'e2')?.from).toEqual([
      ANY_NODE_KIND,
    ]);
  });

  test('名前空間を持つ名前はそのまま、`kind` は配らない (template-update K7)', () => {
    const t = templateFromSheet(
      {
        ...sheet,
        nodes: sheet.nodes.map((n) =>
          n.id === claim
            ? {
                ...n,
                properties: {
                  'jp.co.example.score': 3,
                  kind: 'x',
                  'app.conversensus.propertySchema.kind': { type: 'number' },
                },
              }
            : n,
        ),
      },
      TEMPLATE_ID,
    );
    const claimKind = t.nodeKinds.find((k) => String(k.id) === claim);
    expect(claimKind?.defaults).toEqual({ 'jp.co.example.score': 3 });
    expect(claimKind?.schema).toEqual({});
  });

  test('label が重複した node は両方とも種類にせず、そこに繋がる edge も種類にしない (K6)', () => {
    const twin = '00000000-0000-4000-8000-0000000000b3' as NodeId;
    const duplicated: Sheet = {
      ...sheet,
      nodes: [...sheet.nodes, { id: twin, content: '', label: ' 主張 ' }],
    };
    const t = templateFromSheet(duplicated, TEMPLATE_ID);
    // 前後の空白は除いて比べる
    expect(duplicateKindLabels(duplicated)).toEqual(['主張']);
    expect(t.nodeKinds.map((k) => k.label)).toEqual(['データ']);
    // データ → 主張 (e1)・説明 → 主張 (e2) は、主張が無効なので種類にならない。
    // 「任意」の端と読むと、データ → 任意 という意図しない種類ができる
    expect(t.edgeKinds).toEqual([]);
  });

  test('種類の見た目は node の見た目 (group・image)。markdown の node は見た目を持たない (#406)', () => {
    const group = '00000000-0000-4000-8000-0000000000b1' as NodeId;
    const image = '00000000-0000-4000-8000-0000000000b2' as NodeId;
    const t = templateFromSheet(
      {
        ...sheet,
        nodes: [
          ...sheet.nodes,
          { id: group, content: '', label: '議論', nodeType: 'group' },
          { id: image, content: '', label: '図', nodeType: 'image' },
        ],
      },
      TEMPLATE_ID,
    );
    const nodeTypeOf = (id: NodeId) =>
      t.nodeKinds.find((k) => String(k.id) === id)?.nodeType;
    expect(nodeTypeOf(group)).toBe('group');
    expect(nodeTypeOf(image)).toBe('image');
    expect(nodeTypeOf(claim)).toBeUndefined();
  });

  test('template id は template graph の sheet から作り、種別プロパティの名前空間になる', () => {
    expect(kindPropertyOf(templateIdOf(SHEET))).toBe(`template.${SHEET}.kind`);
  });
});

describe('resolveTemplates', () => {
  const FILE: FileId = FileIdSchema.parse(
    '00000000-0000-4000-8000-0000000000f1',
  );
  const ACTOR = 'did:plc:alice#dev-a' as Actor;
  const claim = NODE_IDS[0] as NodeId;

  /** template graph を作り、claim を置き、その後で label を書き換える歴史 */
  function history() {
    const clock = new CausalClock(ACTOR);
    const issue = (ops: Op[], sheetId?: SheetId): Batch => {
      const stamp = clock.issue();
      return {
        id: `b${stamp.seq}` as Batch['id'],
        actor: ACTOR,
        ...stamp,
        timestamp: stamp.clock,
        ops,
        ...(sheetId && { sheetId }),
      };
    };
    const trunk: Batch[] = [
      issue([
        { kind: 'sheet.create', target: SHEET, name: 'T' },
        {
          kind: 'sheet.setProperty',
          target: SHEET,
          name: SHEET_KIND_PROPERTY,
          value: TEMPLATE_SHEET_KIND,
        },
      ]),
      issue(
        [
          { kind: 'node.add', target: claim, content: '' },
          { kind: 'node.setLabel', target: claim, label: '主張' },
        ],
        SHEET,
      ),
    ];
    const at = heldMaxima(trunk);
    trunk.push(
      issue([{ kind: 'node.setLabel', target: claim, label: '結論' }], SHEET),
    );
    return { trunk, at };
  }

  test('切断面で読む: 当てた後に template graph を直しても、当てた時点の種類が出る', () => {
    const { trunk, at } = history();
    const [t] = resolveTemplates([{ sheet: SHEET, at }], trunk, FILE);
    expect(t?.nodeKinds.map((k) => k.label)).toEqual(['主張']);
  });

  test('種別が template でない sheet・無い sheet は黙って落とす', () => {
    const { trunk, at } = history();
    const other = SheetIdSchema.parse('00000000-0000-4000-8000-0000000000a9');
    expect(resolveTemplates([{ sheet: other, at }], trunk, FILE)).toEqual([]);
    const plain = trunk.filter(
      (b) => !b.ops.some((op) => op.kind === 'sheet.setProperty'),
    );
    expect(resolveTemplates([{ sheet: SHEET, at }], plain, FILE)).toEqual([]);
  });

  test('作り込みの id は解決しない (Q1: template はすべて File の中の template graph)', () => {
    const { trunk } = history();
    expect(
      resolveTemplates(['jp.co.metabolics.toulmin' as never], trunk, FILE),
    ).toEqual([]);
  });
});
