import { describe, expect, test } from 'bun:test';
import {
  ADDRESSEE_PROPERTY,
  ANSWER_TARGET_PROPERTY,
  isRequestNode,
  requestStatus,
} from '../events/request';
import { SHEET_KIND_PROPERTY, TEMPLATE_SHEET_KIND } from '../events/sheetKind';
import type { GraphNode, Sheet, TemplateId } from '../schemas';
import { templateFromSheet } from './fromSheet';
import { kindPropertyOf } from './kind';
import { REQUEST_TEMPLATE } from './request';
import { templateGraphOf } from './seed';
import { localizeSeed } from './seedLocale';

/** 種を File の template graph に複製し、そこから template を読み直す (「シートを追加 ▾」と同じ道) */
function copiedTemplate() {
  const graph = templateGraphOf(REQUEST_TEMPLATE, () => crypto.randomUUID());
  const sheet = {
    id: crypto.randomUUID(),
    name: REQUEST_TEMPLATE.name,
    properties: { [SHEET_KIND_PROPERTY]: TEMPLATE_SHEET_KIND },
    ...graph,
  } as unknown as Sheet;
  return templateFromSheet(sheet, `template.${sheet.id}` as TemplateId);
}

describe('依頼・相談の種 (R2)', () => {
  test('種類は依頼と相談。edge の種類は持たない (答えの edge は「答える」だけが作る)', () => {
    expect(REQUEST_TEMPLATE.nodeKinds.map((k) => k.label)).toEqual([
      '依頼',
      '相談',
    ]);
    expect(REQUEST_TEMPLATE.edgeKinds).toEqual([]);
  });

  test('複製した template graph から読み直しても、種類の既定値に宛先 (空) と答えの場所が残る', () => {
    const template = copiedTemplate();
    for (const kind of template.nodeKinds) {
      expect(kind.defaults).toEqual({
        [ADDRESSEE_PROPERTY]: [],
        [ANSWER_TARGET_PROPERTY]: 'linkedNode',
      });
    }
  });

  test('その種類で作った node は、作った時から応答を求める node で、下書き', () => {
    const template = copiedTemplate();
    const kind = template.nodeKinds[0];
    if (!kind) throw new Error('種類が無い');
    // 画面が node を作るときと同じく、既定値に種別プロパティを足す (GraphEditor)
    const node = {
      id: crypto.randomUUID(),
      content: 'この章を要約して',
      label: kind.label,
      properties: { ...kind.defaults, [kindPropertyOf(template.id)]: kind.id },
    } as GraphNode;
    expect(isRequestNode(node)).toBe(true);
    expect(requestStatus(node, [])).toBe('draft');
  });

  test('en に訳すと名前と種類名が英語になり、既定値は変わらない', () => {
    const en = localizeSeed(REQUEST_TEMPLATE, 'en');
    expect(en.name).toBe('Request / Consultation');
    expect(en.nodeKinds.map((k) => k.label)).toEqual([
      'Request',
      'Consultation',
    ]);
    expect(en.nodeKinds.map((k) => k.defaults)).toEqual(
      REQUEST_TEMPLATE.nodeKinds.map((k) => k.defaults),
    );
  });
});
