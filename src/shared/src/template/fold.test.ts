import { describe, expect, test } from 'bun:test';
import { edgeKindsOf, nodeKindsOf } from './fold';
import { TOULMIN_TEMPLATE } from './toulmin';
import { type Template, TemplateSchema } from './types';

/** テスト用の template を組む。参照整合性は schema が見るので必ず parse を通す */
function template(
  id: string,
  nodeKinds: { id: string; label: string }[],
  edgeKinds: { id: string; label: string; from: string[]; to: string[] }[],
): Template {
  return TemplateSchema.parse({ id, name: id, nodeKinds, edgeKinds });
}

/** toulmin と語彙が重ならない 2 つ目の template (和を測るための対照) */
const OTHER = template(
  'com.example.other',
  [
    { id: 'question', label: '問い' },
    { id: 'answer', label: '答え' },
  ],
  [{ id: 'answers', label: '答える', from: ['answer'], to: ['question'] }],
);

describe('nodeKindsOf / edgeKindsOf', () => {
  test('toulmin の 5 種別と 5 つの接続をそのまま返す', () => {
    expect(nodeKindsOf([TOULMIN_TEMPLATE]).map((r) => r.kind.label)).toEqual([
      '主張',
      'データ',
      '論拠',
      '反論',
      '裏付け',
    ]);
    expect(edgeKindsOf([TOULMIN_TEMPLATE]).map((r) => r.kind.label)).toEqual([
      '支える',
      '正当化する',
      '強化する',
      '切り崩す',
      '疑問を呈する',
    ]);
  });

  test('template が無ければ種別は空 (種別メニューを出さない根拠)', () => {
    expect(nodeKindsOf([])).toEqual([]);
    expect(edgeKindsOf([])).toEqual([]);
  });

  test('複数 template は和になる — 狭めない', () => {
    const labels = nodeKindsOf([TOULMIN_TEMPLATE, OTHER]).map(
      (r) => r.kind.label,
    );
    expect(labels).toContain('主張');
    expect(labels).toContain('問い');
    expect(labels).toHaveLength(7);
  });

  test('同じ id は先に来た方を残す (並びを安定させる)', () => {
    const a = template('com.example.a', [{ id: 'x', label: 'A の X' }], []);
    const b = template('com.example.b', [{ id: 'x', label: 'B の X' }], []);
    expect(nodeKindsOf([a, b]).map((r) => r.kind.label)).toEqual(['A の X']);
    expect(nodeKindsOf([b, a]).map((r) => r.kind.label)).toEqual(['B の X']);
  });
});
