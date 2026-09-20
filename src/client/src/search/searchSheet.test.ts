import { describe, expect, test } from 'bun:test';
import {
  EdgeIdSchema,
  type GraphEdge,
  type GraphNode,
  NodeIdSchema,
  type Sheet,
  SheetIdSchema,
  SYSTEM_PROPERTY_PREFIX,
} from '@conversensus/shared';
import { SNIPPET_CONTEXT, searchSheet } from './searchSheet';

const SOURCE = NodeIdSchema.parse(crypto.randomUUID());
const TARGET = NodeIdSchema.parse(crypto.randomUUID());

function node(over: Partial<GraphNode> = {}): GraphNode {
  return {
    id: NodeIdSchema.parse(crypto.randomUUID()),
    content: '',
    ...over,
  };
}

function edge(over: Partial<GraphEdge> = {}): GraphEdge {
  return {
    id: EdgeIdSchema.parse(crypto.randomUUID()),
    source: SOURCE,
    target: TARGET,
    ...over,
  };
}

function sheet(nodes: GraphNode[], edges: GraphEdge[] = []): Sheet {
  return {
    id: SheetIdSchema.parse(crypto.randomUUID()),
    name: 'シート',
    nodes,
    edges,
  };
}

describe('走査する欄', () => {
  test('node の label が当たる', () => {
    // label は**種別名**である (Phase 5 P0 で本文と語を分けた)
    const hits = searchSheet(sheet([node({ label: '主張' })]), '主張');
    expect(hits).toHaveLength(1);
    expect(hits[0].field).toBe('label');
    expect(hits[0].elementKind).toBe('node');
  });

  test('node の content が当たる — label と取り違えていない', () => {
    const hits = searchSheet(
      sheet([node({ label: '主張', content: '本文にだけある語' })]),
      'にだけある',
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].field).toBe('content');
  });

  test('edge の label が当たる', () => {
    const hits = searchSheet(sheet([], [edge({ label: '根拠づけ' })]), '根拠');
    expect(hits).toHaveLength(1);
    expect(hits[0].elementKind).toBe('edge');
    expect(hits[0].field).toBe('label');
  });

  test('label を持たない要素は label の欄ごと無い', () => {
    // template が当たっていないシートでは label は undefined である
    expect(searchSheet(sheet([node({ content: 'あ' })]), 'あ')).toHaveLength(1);
  });

  test('content が空なら拾わない', () => {
    // 空文字列に検索語が含まれることはないが、空の欄を 1 件として出さないことを固定する
    expect(searchSheet(sheet([node({ content: '' })]), 'あ')).toEqual([]);
  });
});

describe('system のプロパティは検索に出さない', () => {
  test('app.conversensus.* はヒットしない', () => {
    // 画面に出ないものが検索だけで出てくると、開けない結果になる
    const hits = searchSheet(
      sheet([
        node({
          properties: {
            [`${SYSTEM_PROPERTY_PREFIX}imageUrl`]: 'https://例/a.png',
          },
        }),
      ]),
      '例',
    );
    expect(hits).toEqual([]);
  });

  test('extension はヒットする', () => {
    // 仕様は extension を「一部は不可視」とするが既定は見える側である。
    // system と同じ扱いにすると template の種別で検索できなくなる
    const hits = searchSheet(
      sheet([
        node({ properties: { 'jp.co.metabolics.toulmin.kind': '主張' } }),
      ]),
      '主張',
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].field).toBe('property');
    expect(hits[0].propertyName).toBe('jp.co.metabolics.toulmin.kind');
  });

  test('custom はヒットし、型も付く', () => {
    const hits = searchSheet(
      sheet([node({ properties: { 期限: '2026-09-20' } })]),
      '2026',
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].propertyName).toBe('期限');
    // **型は宣言から来る** (値から推論しない、利用者判断 2026-09-20)。
    // step 2 に宣言の仕組みは無いので文字列である。`2026-09-20` に「日付」と
    // 出すのは、宣言されていない型の推測になる
    expect(hits[0].propertyType).toBe('string');
  });
});

describe('1 つの要素が複数件になる', () => {
  test('label と content の両方に含まれれば 2 件', () => {
    // 1 件に畳むと、結果一覧が「どの欄で当たったか」を出せなくなる
    const hits = searchSheet(
      sheet([node({ label: '同じ語', content: '同じ語がここにも' })]),
      '同じ語',
    );
    expect(hits.map((h) => h.field)).toEqual(['label', 'content']);
  });

  test('同じ欄の 2 つ目以降は拾わない', () => {
    // 仕様は部分一致までしか求めていない。増やすと結果一覧が同じ要素で埋まる
    expect(searchSheet(sheet([node({ content: 'aaa' })]), 'a')).toHaveLength(1);
  });
});

describe('大小文字のトグル', () => {
  test('既定は無視する', () => {
    expect(
      searchSheet(sheet([node({ content: 'Hello' })]), 'hello'),
    ).toHaveLength(1);
    expect(
      searchSheet(sheet([node({ content: 'hello' })]), 'HELLO'),
    ).toHaveLength(1);
  });

  test('caseSensitive なら区別する', () => {
    const s = sheet([node({ content: 'Hello' })]);
    expect(searchSheet(s, 'hello', { caseSensitive: true })).toEqual([]);
    expect(searchSheet(s, 'Hello', { caseSensitive: true })).toHaveLength(1);
  });

  test('大小を無視しても位置は元の文字列の上で数える', () => {
    const hits = searchSheet(sheet([node({ content: 'xxHELLO' })]), 'hello');
    expect(
      hits[0].snippet.slice(
        hits[0].matchStart,
        hits[0].matchStart + hits[0].matchLength,
      ),
    ).toBe('HELLO');
  });
});

describe('空の検索語', () => {
  test('空文字列は 0 件', () => {
    // 空文字列はあらゆる文字列に含まれる。素直に当てると全要素がヒットし、
    // それは検索の結果ではなく一覧である
    expect(searchSheet(sheet([node({ content: 'あ' })]), '')).toEqual([]);
  });

  test('空白だけの検索語は止めない', () => {
    // 空白は正当な検索語である。trim して空かで判定すると空白が探せなくなる
    expect(searchSheet(sheet([node({ content: 'a b' })]), ' ')).toHaveLength(1);
  });
});

describe('抜粋は窓であって全文ではない', () => {
  test('短い文字列は全文で、省略記号は付かない', () => {
    // 実際には全文が見えているのに省略されたように読ませない
    const hits = searchSheet(sheet([node({ content: 'abc' })]), 'b');
    expect(hits[0].snippet).toBe('abc');
    expect(hits[0].matchStart).toBe(1);
  });

  test('前後が切れていれば省略記号が付き、matchStart がその分ずれる', () => {
    const before = 'x'.repeat(SNIPPET_CONTEXT + 20);
    const after = 'y'.repeat(SNIPPET_CONTEXT + 20);
    const hits = searchSheet(
      sheet([node({ content: `${before}HIT${after}` })]),
      'HIT',
    );
    const hit = hits[0];
    expect(hit.snippet.startsWith('…')).toBe(true);
    expect(hit.snippet.endsWith('…')).toBe(true);
    // ここを足し忘れると結果一覧のハイライトが 1 文字ずれる。
    // **先頭でヒットしたときだけ正しく見える**ので、前が切れる場合を明示的に引く
    expect(
      hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength),
    ).toBe('HIT');
  });

  test('前だけが切れる場合も位置が合う', () => {
    const before = 'x'.repeat(SNIPPET_CONTEXT + 20);
    const hits = searchSheet(sheet([node({ content: `${before}HIT` })]), 'HIT');
    const hit = hits[0];
    expect(hit.snippet.startsWith('…')).toBe(true);
    expect(hit.snippet.endsWith('…')).toBe(false);
    expect(
      hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength),
    ).toBe('HIT');
  });
});

describe('プロパティの値の文字列化', () => {
  test('数値と真偽値は文字列にして探せる', () => {
    expect(
      searchSheet(sheet([node({ properties: { 優先度: 42 } })]), '42'),
    ).toHaveLength(1);
    expect(
      searchSheet(sheet([node({ properties: { 確定: true } })]), 'true'),
    ).toHaveLength(1);
  });

  test('配列は要素を並べる — 引用符や角括弧を混ぜない', () => {
    // 人が打つのは `a` であって `"a"` ではない
    const s = sheet([node({ properties: { 出典: ['甲', '乙'] } })]);
    expect(searchSheet(s, '甲')).toHaveLength(1);
    expect(searchSheet(s, '甲, 乙')).toHaveLength(1);
    expect(searchSheet(s, '"甲"')).toEqual([]);
    expect(searchSheet(s, '[')).toEqual([]);
  });

  test('配列でも型は文字列である (値から推論しない)', () => {
    // 値の形は「配列を並べて検索できる」ことに効くが、**型は宣言から来る**。
    // property editor 側も同じ規則で、そちらは配列を編集させない判断に
    // **値の形**を使っている (型ではない)
    const hits = searchSheet(
      sheet([node({ properties: { 出典: ['甲'] } })]),
      '甲',
    );
    expect(hits[0].propertyType).toBe('string');
  });

  test('値が無いプロパティは拾わない', () => {
    expect(
      searchSheet(sheet([node({ properties: { 備考: null } })]), 'a'),
    ).toEqual([]);
  });
});

describe('結果の順序は安定する', () => {
  test('node → edge、要素の中では label → content → property', () => {
    // 並びが実行のたびに変わると、同じ検索で結果一覧の見え方が変わる
    const hits = searchSheet(
      sheet(
        [node({ label: '語', content: '語', properties: { 備考: '語' } })],
        [edge({ label: '語' })],
      ),
      '語',
    );
    expect(hits.map((h) => `${h.elementKind}:${h.field}`)).toEqual([
      'node:label',
      'node:content',
      'node:property',
      'edge:label',
    ]);
  });
});
