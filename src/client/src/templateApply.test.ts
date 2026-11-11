import { describe, expect, test } from 'bun:test';
import {
  appliedTemplatePropertyOf,
  appliedTemplateValueOf,
  METAGRAPH_SHEET_KIND,
  SHEET_KIND_PROPERTY,
  type Sheet,
  type SheetId,
  TEMPLATE_SHEET_KIND,
} from '@conversensus/shared';
import { applicableTemplateGraphs } from './templateApply';

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}` as SheetId;
const sheet = (n: number, extra: Partial<Sheet> = {}): Sheet => ({
  id: id(n),
  name: `S${n}`,
  nodes: [],
  edges: [],
  ...extra,
});
const template = (n: number) =>
  sheet(n, { properties: { [SHEET_KIND_PROPERTY]: TEMPLATE_SHEET_KIND } });
const AT = { 'did:plc:alice#dev-a': 1 };

describe('applicableTemplateGraphs (#355)', () => {
  const t1 = template(1);
  const t2 = template(2);
  const t3 = template(3);

  test('当たっていない template graph を File の中の順で返す (ふつうの Sheet は並べない)', () => {
    const target = sheet(4);
    expect(
      applicableTemplateGraphs([t2, target, t1], target).map((s) => s.id),
    ).toEqual([t2.id, t1.id]);
  });

  test('作るときに当てたものも、後から当てたものも除く', () => {
    const target = sheet(4, {
      templateIds: [{ sheet: t1.id, at: AT }],
      properties: {
        [appliedTemplatePropertyOf(t2.id)]: appliedTemplateValueOf(AT),
      },
    });
    expect(
      applicableTemplateGraphs([t1, t2, t3, target], target).map((s) => s.id),
    ).toEqual([t3.id]);
  });

  test('template graph と metagraph の Sheet には当てない', () => {
    const index = sheet(5, {
      properties: { [SHEET_KIND_PROPERTY]: METAGRAPH_SHEET_KIND },
    });
    expect(applicableTemplateGraphs([t1, t2, index], t1)).toEqual([]);
    expect(applicableTemplateGraphs([t1, t2, index], index)).toEqual([]);
  });
});
