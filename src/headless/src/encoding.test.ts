import { describe, expect, test } from 'bun:test';
import {
  appliedTemplatePropertyOf,
  type EdgeId,
  type GraphFile,
  type NodeId,
  type Sheet,
  type SheetId,
  type Template,
  TemplateSchema,
} from '@conversensus/shared';
import fc from 'fast-check';
import { encodeFile } from './encoding';

// --- テスト専用の読み戻し -----------------------------------------------------------
// 本体には逆向きを作らない (設計 D4)。ここでは「注釈を除いた行から元が復元できる」ことを
// 確かめるためだけに読む。

/** `keyword rest` の rest を JSON として読む */
const json = (line: string, keyword: string): unknown =>
  JSON.parse(line.slice(line.indexOf(keyword) + keyword.length + 1));

function decode(text: string): GraphFile {
  let file: GraphFile | undefined;
  let sheet: Sheet | undefined;
  // 今書いている要素 (node か edge)。prop・layout はここに付く
  let current:
    | { kind: 'node' | 'edge'; el: Record<string, unknown> }
    | undefined;
  const props = (el: Record<string, unknown>) => {
    el.properties ??= {};
    return el.properties as Record<string, unknown>;
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimStart();
    if (line.startsWith('#')) continue;
    const depth = (raw.length - line.length) / 2;
    const [keyword, ...words] = line.split(' ');
    if (depth === 0 && keyword === 'file') {
      file = { id: words[0], name: '', sheets: [] } as unknown as GraphFile;
      current = undefined;
    } else if (depth === 0 && keyword === 'sheet') {
      sheet = {
        id: words[0],
        name: '',
        nodes: [],
        edges: [],
      } as unknown as Sheet;
      file?.sheets.push(sheet);
      current = undefined;
    } else if (depth === 1 && keyword === 'node') {
      const node = { id: words[0], content: '' };
      sheet?.nodes.push(node as never);
      current = { kind: 'node', el: node };
    } else if (depth === 1 && keyword === 'edge') {
      const edge = { id: words[0], source: words[1], target: words[3] };
      sheet?.edges.push(edge as never);
      current = { kind: 'edge', el: edge };
    } else if (depth === 1 && sheet === undefined && file) {
      (file as Record<string, unknown>)[keyword as string] = json(
        line,
        keyword as string,
      );
    } else if (depth === 1 && sheet) {
      const s = sheet as Record<string, unknown>;
      if (keyword === 'template-ref') {
        s.templateIds = [
          ...((s.templateIds as unknown[]) ?? []),
          json(line, keyword),
        ];
      } else if (keyword === 'prop') {
        const [name, v] = JSON.parse(
          `[${line.slice('prop '.length).replace(/^("(?:[^"\\]|\\.)*") /, '$1,')}]`,
        );
        props(s)[name] = v;
      } else if (keyword === 'node-layout') {
        s.layouts = [...((s.layouts as unknown[]) ?? []), json(line, keyword)];
      } else if (keyword === 'edge-layout') {
        s.edgeLayouts = [
          ...((s.edgeLayouts as unknown[]) ?? []),
          json(line, keyword),
        ];
      } else {
        s[keyword as string] = json(line, keyword as string);
      }
    } else if (depth === 2 && current && sheet) {
      const { el, kind } = current;
      if (keyword === 'prop') {
        const [name, v] = JSON.parse(
          `[${line.slice('prop '.length).replace(/^("(?:[^"\\]|\\.)*") /, '$1,')}]`,
        );
        props(el)[name] = v;
      } else if (keyword === 'parent') {
        el.parentId = words[0];
      } else if (keyword === 'layout') {
        const layout = json(line, keyword) as Record<string, unknown>;
        if (kind === 'node') {
          sheet.layouts = [
            ...(sheet.layouts ?? []),
            { nodeId: el.id as NodeId, ...layout },
          ];
        } else {
          sheet.edgeLayouts = [
            ...(sheet.edgeLayouts ?? []),
            { edgeId: el.id as EdgeId, ...layout },
          ];
        }
      } else {
        el[keyword === 'type' ? 'nodeType' : (keyword as string)] = json(
          line,
          keyword as string,
        );
      }
    } else {
      throw new Error(`読めない行: ${raw}`);
    }
  }
  if (!file) throw new Error('file の行が無い');
  return file;
}

/**
 * 比べる前に揃える: layout の並び (encoding は node の順に出す) と、空の property・空の
 * `templateIds` (書く行が無い。どちらも「無い」と同じ意味)。
 * どちらも projection の意味を変えない
 */
function normalize(file: GraphFile): GraphFile {
  const byId =
    (key: string) => (a: Record<string, unknown>, b: Record<string, unknown>) =>
      String(a[key]).localeCompare(String(b[key]));
  const dropEmpty = <T extends { properties?: Record<string, unknown> }>(
    el: T,
  ): T => {
    if (el.properties && Object.keys(el.properties).length === 0) {
      const { properties: _, ...rest } = el;
      return rest as T;
    }
    return el;
  };
  return JSON.parse(
    JSON.stringify({
      ...file,
      sheets: file.sheets.map((s) => {
        const sheet = dropEmpty({
          ...s,
          nodes: s.nodes.map(dropEmpty),
          edges: s.edges.map(dropEmpty),
        });
        const { layouts, edgeLayouts, templateIds, ...rest } = sheet;
        return {
          ...rest,
          ...(templateIds?.length && { templateIds }),
          ...(layouts?.length && {
            layouts: [...layouts].sort(byId('nodeId')),
          }),
          ...(edgeLayouts?.length && {
            edgeLayouts: [...edgeLayouts].sort(byId('edgeId')),
          }),
        };
      }),
    }),
  );
}

// --- 生成器 ---------------------------------------------------------------------

/** 本文や名前: 改行・引用符・`#`・`->` など、行の形を壊しうる文字を混ぜる */
const text = fc.oneof(
  fc.string(),
  fc.constantFrom(
    '',
    ' ',
    '"',
    '\\',
    '\n',
    '# 注釈ではない',
    'a -> b',
    '主張\n根拠',
  ),
);
const propName = fc.constantFrom(
  'priority',
  'app.conversensus.image',
  'template.s.kind',
  'jp.example.memo',
);
const properties = fc.option(fc.dictionary(propName, fc.jsonValue()), {
  nil: undefined,
});

const sheetArb: fc.Arbitrary<Sheet> = fc
  .record({
    id: fc.uuid(),
    name: text,
    description: fc.option(text, { nil: undefined }),
    templateIds: fc.option(
      fc.array(fc.record({ sheet: fc.uuid(), at: fc.nat() }), { maxLength: 2 }),
      { nil: undefined },
    ),
    properties,
    nodeIds: fc.uniqueArray(fc.uuid(), { maxLength: 4 }),
    edgeIds: fc.uniqueArray(fc.uuid(), { maxLength: 3 }),
    orphanIds: fc.uniqueArray(fc.uuid(), { maxLength: 1 }),
  })
  .chain(({ nodeIds, edgeIds, orphanIds, ...sheet }) => {
    const ref = nodeIds.length ? fc.constantFrom(...nodeIds) : fc.uuid();
    return fc
      .record({
        nodes: fc.tuple(
          ...nodeIds.map((id) =>
            fc.record({
              id: fc.constant(id),
              content: text,
              label: fc.option(text, { nil: undefined }),
              properties,
              nodeType: fc.option(
                fc.constantFrom('group' as const, 'image' as const),
                {
                  nil: undefined,
                },
              ),
              parentId: fc.option(ref, { nil: undefined }),
            }),
          ),
        ),
        edges: fc.tuple(
          ...edgeIds.map((id) =>
            fc.record({
              id: fc.constant(id),
              source: ref,
              target: ref,
              label: fc.option(text, { nil: undefined }),
              properties,
            }),
          ),
        ),
        // layout は一部の node・edge に、加えて対応の無いもの (orphan) も
        layouts: fc.subarray([...nodeIds, ...orphanIds]).chain((ids) =>
          fc.tuple(
            ...ids.map((nodeId) =>
              fc.record({
                nodeId: fc.constant(nodeId),
                x: fc.integer(),
                y: fc.integer(),
              }),
            ),
          ),
        ),
        edgeLayouts: fc.subarray([...edgeIds, ...orphanIds]).chain((ids) =>
          fc.tuple(
            ...ids.map((edgeId) =>
              fc.record({
                edgeId: fc.constant(edgeId),
                pathType: fc.constantFrom('bezier' as const, 'step' as const),
              }),
            ),
          ),
        ),
      })
      .map((parts) => ({ ...sheet, ...parts }) as unknown as Sheet);
  });

const fileArb: fc.Arbitrary<GraphFile> = fc
  .record({
    id: fc.uuid(),
    name: text,
    description: fc.option(text, { nil: undefined }),
    sheets: fc.array(sheetArb, { maxLength: 3 }),
  })
  .map((f) => f as unknown as GraphFile);

/** JSON に載らないもの (undefined のキー) を落とす。projection は JSON から来るので同じ形 */
const plain = (file: GraphFile): GraphFile => JSON.parse(JSON.stringify(file));

// --- テスト ---------------------------------------------------------------------

const SHEET = '11111111-1111-4111-8111-111111111111';
const CLAIM = '22222222-2222-4222-8222-222222222222';
const GROUND = '33333333-3333-4333-8333-333333333333';
const EDGE = '44444444-4444-4444-8444-444444444444';
const FILE = '55555555-5555-4555-8555-555555555555';
const TEMPLATE_SHEET = '66666666-6666-4666-8666-666666666666';
const KIND_CLAIM = '77777777-7777-4777-8777-777777777777';
const TEMPLATE_ID = `template.${TEMPLATE_SHEET}`;
const KIND_PROPERTY = `${TEMPLATE_ID}.kind`;

const toulmin: Template = TemplateSchema.parse({
  id: TEMPLATE_ID,
  name: 'toulmin',
  nodeKinds: [{ id: KIND_CLAIM, label: '主張', description: '言いたいこと' }],
  edgeKinds: [],
});

const example = {
  id: FILE,
  name: '週休',
  sheets: [
    {
      id: SHEET,
      name: '議論',
      templateIds: [{ sheet: TEMPLATE_SHEET, at: 3 }],
      nodes: [
        {
          id: CLAIM,
          content: '週休 3 日にする',
          label: '主張',
          properties: {
            [KIND_PROPERTY]: KIND_CLAIM,
            'app.conversensus.image': { cid: 'x' },
          },
        },
        { id: GROUND, content: '生産性が\n落ちない' },
      ],
      edges: [{ id: EDGE, source: GROUND, target: CLAIM, label: '支える' }],
      layouts: [{ nodeId: CLAIM, x: 120, y: 80 }],
    },
  ],
} as unknown as GraphFile;

describe('encodeFile', () => {
  test('node・edge の id と本文・label・layout を行に出す', () => {
    const text = encodeFile(example);
    expect(text).toContain(`node ${CLAIM}`);
    expect(text).toContain('content "週休 3 日にする"');
    expect(text).toContain(`edge ${EDGE} ${GROUND} -> ${CLAIM}`);
    expect(text).toContain('label "支える"');
    expect(text).toContain('layout {"x":120,"y":80}');
  });

  test('改行を含む本文も 1 行に収まる (JSON の文字列)', () => {
    expect(encodeFile(example)).toContain('content "生産性が\\n落ちない"');
  });

  test('template を渡すと、種別の一覧と種別の名前と種別の説明を注釈に出す', () => {
    const text = encodeFile(example, () => [toulmin]);
    expect(text).toContain(
      `# template "toulmin" (${TEMPLATE_ID}): node 種別 "主張"=${KIND_CLAIM}`,
    );
    expect(text).toContain('#   "主張": "言いたいこと"');
    expect(text).toContain('# 種別: "主張" (template "toulmin")');
  });

  test('template を引けない種別プロパティは、そうと注釈する', () => {
    expect(encodeFile(example)).toContain('# 種別 (template を引けない)');
  });

  test('後から当てた template (#355) のプロパティには、その template の名前を注釈する', () => {
    const sheet = example.sheets[0] as Sheet;
    const applied = {
      ...example,
      sheets: [
        {
          ...sheet,
          templateIds: undefined,
          properties: {
            [appliedTemplatePropertyOf(TEMPLATE_SHEET as SheetId)]: { at: {} },
          },
        },
      ],
    } as GraphFile;
    expect(encodeFile(applied, () => [toulmin])).toContain(
      '# 後から当てた template "toulmin"',
    );
    expect(encodeFile(applied)).toContain('# 後から当てた template (引けない)');
  });

  test('system の property には「書き換えない」と注釈する', () => {
    expect(encodeFile(example)).toContain(
      '# system (本体のもの。書き換えない)',
    );
  });

  test('例を読み戻すと元に戻る', () => {
    expect(normalize(decode(encodeFile(example)))).toEqual(
      normalize(plain(example)),
    );
  });

  test('性質: 注釈を除いた行から、どんな File も欠けなく復元できる', () => {
    fc.assert(
      fc.property(fileArb, (file) => {
        const templates = () => [toulmin];
        expect(normalize(decode(encodeFile(file, templates)))).toEqual(
          normalize(plain(file)),
        );
      }),
    );
  });

  test('module の注釈は node の行の直後に `# ` を付けて出す (注釈が無ければ何も足さない)', () => {
    const annotate = (node: { id: string }) =>
      node.id === CLAIM ? ['module の注釈'] : [];
    const text = encodeFile(example, () => [], annotate);
    const lines = text.split('\n');
    const at = lines.findIndex((l) => l.trim() === `node ${CLAIM}`);
    expect(lines[at + 1]?.trim()).toBe('# module の注釈');
    expect(text.match(/# module の注釈/g)).toHaveLength(1);
    expect(encodeFile(example)).not.toContain('# module の注釈');
  });
});
