import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { CausalClock } from '../events/causalClock';
import { projectFile } from '../events/project';
import type { Actor, Batch, Op } from '../events/unified';
import {
  type FileId,
  FileIdSchema,
  type SheetId,
  SheetIdSchema,
  type TemplateRef,
} from '../schemas';
import {
  appliedTemplatePropertyOf,
  appliedTemplateRefs,
  appliedTemplateSheetIds,
  appliedTemplateValueOf,
} from './applied';

const sheetId = (n: number): SheetId =>
  SheetIdSchema.parse(`00000000-0000-4000-8000-0000000000${10 + n}`);
/** template graph の sheet の小さなプール。作るときのものと後から当てたものが重なる場合に当たるため */
const TEMPLATE_SHEETS = [0, 1, 2, 3].map(sheetId);
const AT = { 'did:plc:alice#dev-a': 3 };

/** 作るときの参照と、後から当てたプロパティの組。どちらも小さなプールから引く */
const arbSheet = fc.record({
  created: fc.uniqueArray(fc.constantFrom(...TEMPLATE_SHEETS), {
    maxLength: 3,
  }),
  later: fc.uniqueArray(fc.constantFrom(...TEMPLATE_SHEETS), {
    maxLength: 4,
  }),
});

const refsOf = (ids: readonly SheetId[]): TemplateRef[] =>
  ids.map((sheet) => ({ sheet, at: AT }));
const propertiesOf = (ids: readonly SheetId[]) =>
  Object.fromEntries(
    ids.map((id) => [
      appliedTemplatePropertyOf(id),
      appliedTemplateValueOf(AT),
    ]),
  );
const sheetsOf = (refs: readonly TemplateRef[]) =>
  refs.map((ref) => (typeof ref === 'string' ? ref : ref.sheet));

describe('appliedTemplateRefs (#355)', () => {
  test('性質: 作るときのものが先にその順で並び、後から当てたものは重ならない分だけ、id の順で続く', () => {
    fc.assert(
      fc.property(arbSheet, ({ created, later }) => {
        const refs = appliedTemplateRefs({
          templateIds: refsOf(created),
          properties: propertiesOf(later),
        });
        const expected = [
          ...created,
          ...later.filter((id) => !created.includes(id)).sort(),
        ];
        expect(sheetsOf(refs)).toEqual(expected);
      }),
    );
  });

  test('性質: プロパティの並び (畳み込みの順) によらず同じ答えになる', () => {
    fc.assert(
      fc.property(
        arbSheet.chain(({ created, later }) =>
          fc.tuple(
            fc.constant(created),
            fc.constant(later),
            fc.shuffledSubarray(later, {
              minLength: later.length,
              maxLength: later.length,
            }),
          ),
        ),
        ([created, later, shuffled]) => {
          const of = (ids: SheetId[]) =>
            appliedTemplateRefs({
              templateIds: refsOf(created),
              properties: propertiesOf(ids),
            });
          expect(of(shuffled)).toEqual(of(later));
        },
      ),
    );
  });

  test('同じ template graph が両方にあれば、作るときの切断面を採る', () => {
    const [t] = TEMPLATE_SHEETS as [SheetId];
    const created = { sheet: t, at: { 'did:plc:alice#dev-a': 1 } };
    const refs = appliedTemplateRefs({
      templateIds: [created],
      properties: {
        [appliedTemplatePropertyOf(t)]: appliedTemplateValueOf({
          'did:plc:bob#dev-b': 9,
        }),
      },
    });
    expect(refs).toEqual([created]);
  });

  test('後から当てたものが無ければ、作るときのもの (配列そのもの) を返す', () => {
    const templateIds = refsOf([sheetId(0)]);
    expect(
      appliedTemplateRefs({
        templateIds,
        properties: { 'app.conversensus.sheetKind': 'x' },
      }),
    ).toBe(templateIds);
    expect(appliedTemplateRefs({})).toEqual([]);
  });

  test('読めないものは黙って落とす: 形の違う切断面、id でないキー、ほかのプロパティ', () => {
    const refs = appliedTemplateRefs({
      properties: {
        [appliedTemplatePropertyOf(sheetId(0))]: { at: 'x' },
        [appliedTemplatePropertyOf(sheetId(1))]: null,
        [appliedTemplatePropertyOf(sheetId(2))]: 7,
        'app.conversensus.appliedTemplate.not-a-uuid': { at: AT },
        'app.conversensus.sheetKind': 'app.conversensus.template',
        [appliedTemplatePropertyOf(sheetId(3))]: appliedTemplateValueOf(AT),
      },
    });
    expect(refs).toEqual([{ sheet: sheetId(3), at: AT }]);
  });

  test('appliedTemplateSheetIds は作り込みの id を含めず、当たっている template graph の id を返す', () => {
    expect(
      appliedTemplateSheetIds({
        templateIds: [
          'builtin.toulmin' as TemplateRef,
          ...refsOf([sheetId(0)]),
        ],
        properties: propertiesOf([sheetId(1)]),
      }),
    ).toEqual(new Set([sheetId(0), sheetId(1)]));
  });
});

describe('後から当てた template を op-log から畳む (#355)', () => {
  const FILE: FileId = FileIdSchema.parse(
    '00000000-0000-4000-8000-0000000000f1',
  );
  const TARGET = sheetId(9);
  const ALICE = 'did:plc:alice#dev-a' as Actor;
  const BOB = 'did:plc:bob#dev-b' as Actor;

  const issuer = (actor: Actor) => {
    const clock = new CausalClock(actor);
    return {
      clock,
      issue: (ops: Op[]): Batch => {
        const stamp = clock.issue();
        return {
          id: `${actor}-${stamp.seq}` as Batch['id'],
          actor,
          ...stamp,
          timestamp: stamp.clock,
          ops,
        };
      },
    };
  };
  const apply = (template: SheetId): Op => ({
    kind: 'sheet.setProperty',
    target: TARGET,
    name: appliedTemplatePropertyOf(template),
    value: appliedTemplateValueOf(AT),
  });

  test('2 人が同時に別の template を当てても、どちらも残る (キーを template graph ごとに分けたため)', () => {
    const alice = issuer(ALICE);
    const bob = issuer(BOB);
    const created = alice.issue([
      { kind: 'sheet.create', target: TARGET, name: 'S' },
    ]);
    bob.clock.observe(created);
    // どちらも相手の当てたものを知らずに当てる
    const byAlice = alice.issue([apply(sheetId(0))]);
    const byBob = bob.issue([apply(sheetId(1))]);

    for (const order of [
      [created, byAlice, byBob],
      [created, byBob, byAlice],
    ]) {
      const sheet = projectFile(order, FILE).sheets.find(
        (s) => s.id === TARGET,
      );
      expect(sheet && sheetsOf(appliedTemplateRefs(sheet))).toEqual([
        sheetId(0),
        sheetId(1),
      ]);
    }
  });
});
