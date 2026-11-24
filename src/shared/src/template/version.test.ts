import { describe, expect, test } from 'bun:test';
import { CausalClock } from '../events/causalClock';
import { heldMaxima } from '../events/causality';
import { SHEET_KIND_PROPERTY, TEMPLATE_SHEET_KIND } from '../events/sheetKind';
import type { Actor, Batch, Op } from '../events/unified';
import {
  type FileId,
  FileIdSchema,
  type NodeId,
  NodeIdSchema,
  type SheetId,
  SheetIdSchema,
} from '../schemas';
import { TEMPLATE_VERSION, templateVersionOf } from './version';

const FILE: FileId = FileIdSchema.parse('00000000-0000-4000-8000-0000000000f1');
const TEMPLATE_SHEET = SheetIdSchema.parse(
  '00000000-0000-4000-8000-0000000000a1',
);
const OTHER_SHEET = SheetIdSchema.parse('00000000-0000-4000-8000-0000000000a2');
const CLAIM: NodeId = NodeIdSchema.parse(
  '00000000-0000-4000-8000-0000000000b1',
);
const PLAIN: NodeId = NodeIdSchema.parse(
  '00000000-0000-4000-8000-0000000000b2',
);
const ELSEWHERE: NodeId = NodeIdSchema.parse(
  '00000000-0000-4000-8000-0000000000b3',
);
const ACTOR = 'did:plc:alice#dev-a' as Actor;

/** template graph (種類「主張」1 つ) とほかの Sheet を作り、そこで当てた切断面を返す */
function applied() {
  return appliedWith([]);
}

/** `applied` に、当てる前の「主張」への op (`claimOps`) を足したもの */
function appliedWith(claimOps: Op[]) {
  const clock = new CausalClock(ACTOR);
  const trunk: Batch[] = [];
  const issue = (ops: Op[], sheetId?: SheetId) => {
    const stamp = clock.issue();
    trunk.push({
      id: `b${stamp.seq}` as Batch['id'],
      actor: ACTOR,
      ...stamp,
      timestamp: stamp.clock,
      ops,
      ...(sheetId && { sheetId }),
    });
  };
  issue([
    { kind: 'sheet.create', target: TEMPLATE_SHEET, name: 'T' },
    {
      kind: 'sheet.setProperty',
      target: TEMPLATE_SHEET,
      name: SHEET_KIND_PROPERTY,
      value: TEMPLATE_SHEET_KIND,
    },
    { kind: 'sheet.create', target: OTHER_SHEET, name: 'S' },
  ]);
  issue(
    [
      { kind: 'node.add', target: CLAIM, content: '' },
      { kind: 'node.setLabel', target: CLAIM, label: '主張' },
      ...claimOps,
    ],
    TEMPLATE_SHEET,
  );
  const ref = { sheet: TEMPLATE_SHEET, at: heldMaxima(trunk) };
  const versionAfter = (...edits: [Op[], SheetId?][]) => {
    for (const [ops, sheetId] of edits) issue(ops, sheetId);
    return templateVersionOf(ref, trunk, FILE);
  };
  return { versionAfter };
}

describe('templateVersionOf (template-update D2・D3)', () => {
  test('当てた後に何も無ければ current', () => {
    expect(applied().versionAfter()).toBe(TEMPLATE_VERSION.CURRENT);
  });

  test('種類が変われば newer: 名前の変更・種類の追加・既定値・説明', () => {
    const cases: [Op[], SheetId][] = [
      [
        [{ kind: 'node.setLabel', target: CLAIM, label: '結論' }],
        TEMPLATE_SHEET,
      ],
      [
        [
          { kind: 'node.add', target: PLAIN, content: '' },
          { kind: 'node.setLabel', target: PLAIN, label: '根拠' },
        ],
        TEMPLATE_SHEET,
      ],
      [
        [
          {
            kind: 'node.setProperty',
            target: CLAIM,
            name: '担当者',
            value: 'alice',
          },
        ],
        TEMPLATE_SHEET,
      ],
      [
        [{ kind: 'node.setContent', target: CLAIM, content: '結論を一文で' }],
        TEMPLATE_SHEET,
      ],
    ];
    for (const edit of cases) {
      expect(applied().versionAfter(edit)).toBe(TEMPLATE_VERSION.NEWER);
    }
  });

  test('種類が変わらなければ current: 動かしただけ・label の無い node・ほかの Sheet の編集', () => {
    // `at` は File 全体の切断面なので、ほかの Sheet の編集でも進む。op の有無では決めない
    expect(
      applied().versionAfter(
        [
          [
            {
              kind: 'node.setLayout',
              target: CLAIM,
              x: 100,
              y: 200,
            },
          ],
          TEMPLATE_SHEET,
        ],
        [[{ kind: 'node.add', target: PLAIN, content: '' }], TEMPLATE_SHEET],
        [[{ kind: 'node.add', target: ELSEWHERE, content: 'x' }], OTHER_SHEET],
      ),
    ).toBe(TEMPLATE_VERSION.CURRENT);
  });

  test('既定値を消して同じ値で書き直しただけなら current (キーの並びが変わっても同じ種類)', () => {
    const set = (name: string, value?: unknown): Op => ({
      kind: 'node.setProperty',
      target: CLAIM,
      name,
      ...(value !== undefined && { value }),
    });
    const { versionAfter } = appliedWith([
      set('担当者', 'alice'),
      set('期限', ''),
    ]);
    expect(
      versionAfter([[set('担当者'), set('担当者', 'alice')], TEMPLATE_SHEET]),
    ).toBe(TEMPLATE_VERSION.CURRENT);
  });

  test('template graph が消えれば deleted: Sheet の削除・種別の変更', () => {
    expect(
      applied().versionAfter([
        [{ kind: 'sheet.remove', target: TEMPLATE_SHEET }],
      ]),
    ).toBe(TEMPLATE_VERSION.DELETED);
    expect(
      applied().versionAfter([
        [
          {
            kind: 'sheet.setProperty',
            target: TEMPLATE_SHEET,
            name: SHEET_KIND_PROPERTY,
            value: null,
          },
        ],
      ]),
    ).toBe(TEMPLATE_VERSION.DELETED);
  });
});
