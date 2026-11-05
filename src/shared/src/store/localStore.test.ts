import { beforeEach, describe, expect, test } from 'bun:test';
import { computeBlobCid, MAX_BLOB_SIZE } from '../blob';
import {
  DERIVED_FROM_SHEET_PROPERTY,
  derivedNodeIdOf,
} from '../events/derivedNode';
import { projectFile } from '../events/project';
import {
  METAGRAPH_SHEET_KIND,
  SHEET_KIND_PROPERTY,
  sheetKindOf,
  TEMPLATE_SHEET_KIND,
} from '../events/sheetKind';
import type { Batch } from '../events/unified';
import {
  CONVERSENSUS_FILE_VERSION,
  EdgeIdSchema,
  type FileId,
  NodeIdSchema,
} from '../schemas';
import { resolveTemplates, templateIdOf } from '../template/fromSheet';
import { kindPropertyOf, nodeKindIn } from '../template/kind';
import { BunSqliteDriver, IN_MEMORY } from './bunSqliteDriver';
import { EventStore } from './eventStore';
import { LocalStore } from './localStore';

let store: LocalStore;

beforeEach(() => {
  store = new LocalStore(new EventStore(new BunSqliteDriver(IN_MEMORY)));
});

const NODE = '11111111-1111-4111-8111-111111111111';
const EDGE = '22222222-2222-4222-8222-222222222222';

/** 取り込む生の JSON (branded 型になる前の形) */
const payload = (extra: Record<string, unknown> = {}) => ({
  version: '1',
  id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  name: 'インポートファイル',
  description: 'テスト',
  sheets: [
    {
      id: 'ffffffff-0000-4111-8222-333333333333',
      name: 'Sheet 1',
      nodes: [{ id: NODE, content: 'ノード', style: { x: 12, y: 34 } }],
      edges: [{ id: EDGE, source: NODE, target: NODE }],
    },
  ],
  ...extra,
});

const batch = (id: string, clock: number): Batch => ({
  id: id as Batch['id'],
  actor: 'a#dev',
  clock,
  seq: clock,
  deps: {},
  timestamp: clock,
  ops: [
    {
      kind: 'node.add',
      target: `${id}-node` as never,
      content: id,
    },
  ],
});

describe('createFile', () => {
  test('既定の名前で、Sheet 1 と目次の metagraph "index" を持つ File を作り、genesis の op-log を書く', () => {
    const file = store.createFile({});
    expect(file.name).toBe('無題');
    expect(file.sheets.map((s) => s.name)).toEqual(['Sheet 1', 'index']);

    // 作った時点で op-log が正典 — projection が返り値と一致する
    const projected = projectFile(store.getBatches(file.id), file.id);
    expect(projected.name).toBe(file.name);
    expect(projected.sheets.map((s) => s.id)).toEqual(
      file.sheets.map((s) => s.id),
    );
    // index の種別も起点の op-log に載る (step3 Phase 4。以前の genesis はシートのプロパティを落としていた)
    expect(projected.sheets.map((s) => sheetKindOf(s))).toEqual([
      undefined,
      METAGRAPH_SHEET_KIND,
    ]);
  });

  test('一覧に現れる', () => {
    store.createFile({ name: '一覧に出る' });
    expect(store.listFiles().map((f) => f.name)).toEqual(['一覧に出る']);
  });
});

describe('importFile', () => {
  test('ファイル / シート / ノード / エッジの id をすべて振り直し、参照も付け替える', () => {
    const result = store.importFile(payload());
    if (!result.ok) throw new Error('取り込めなかった');
    const sheet = result.file.sheets[0];
    expect(result.file.id).not.toBe(payload().id);
    expect(sheet?.id).not.toBe(payload().sheets[0]?.id);
    expect(sheet?.nodes[0]?.id).not.toBe(NODE);
    expect(sheet?.edges[0]?.id).not.toBe(EDGE);
    expect(sheet?.edges[0]?.source).toBe(sheet?.nodes[0]?.id);
  });

  test('🔴 返した GraphFile と op-log の projection が一致する', () => {
    // id を振り直した後のものを genesis にしなければ、取り込み直後の画面と開き直した画面が
    // 別物になる
    const result = store.importFile(payload());
    if (!result.ok) throw new Error('取り込めなかった');
    const projected = projectFile(
      store.getBatches(result.file.id),
      result.file.id,
    );
    expect(projected.sheets[0]?.nodes.map((n) => n.id)).toEqual(
      result.file.sheets[0]?.nodes.map((n) => n.id),
    );
    expect(projected.sheets[0]?.edges[0]?.source).toBe(
      result.file.sheets[0]?.nodes[0]?.id,
    );
  });

  test('🔴 同梱された blobs は op-log に入らない (ANA-116 D1)', () => {
    // base64 の実体を op-log に流すとレコード上限に当たる (ANA-116 が直した問題)
    const result = store.importFile(
      payload({
        version: '5',
        blobs: [
          {
            cid: 'bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq',
            mimeType: 'image/png',
            data: 'AQID',
          },
        ],
      }),
    );
    if (!result.ok) throw new Error('取り込めなかった');
    expect(result.file).not.toHaveProperty('blobs');
    expect(JSON.stringify(store.getBatches(result.file.id))).not.toContain(
      'AQID',
    );
  });

  test('🔴 metagraph の graph node を二重にせず、張った edge と置き場所を新しい graph node に付ける (step4)', () => {
    // 書き出した File には導出した graph node が載っている。ふつうの node として取り込むと、
    // 古い Sheet を指す node が残り、新しい graph node と二重になっていた
    const original = store.createFile({ name: '元' });
    const [plain, meta] = original.sheets;
    if (!plain || !meta) throw new Error('Sheet が足りない');
    const graphNode = derivedNodeIdOf(plain.id);
    const note = NodeIdSchema.parse('11111111-1111-4111-8111-111111111111');
    const exported = {
      ...projectFile(store.getBatches(original.id), original.id),
      version: CONVERSENSUS_FILE_VERSION,
    };
    exported.sheets = exported.sheets.map((sheet) =>
      sheet.id === meta.id
        ? {
            ...sheet,
            nodes: [...sheet.nodes, { id: note, content: 'メモ' }],
            edges: [
              {
                id: EdgeIdSchema.parse('22222222-2222-4222-8222-222222222222'),
                source: note,
                target: graphNode,
              },
            ],
            layouts: [{ nodeId: graphNode, x: 10, y: 20 }],
          }
        : sheet,
    );

    const result = store.importFile(JSON.parse(JSON.stringify(exported)));
    if (!result.ok) throw new Error('取り込めなかった');
    const imported = projectFile(
      store.getBatches(result.file.id),
      result.file.id,
    );
    const [newPlain, newMeta] = imported.sheets;
    if (!newPlain || !newMeta) throw new Error('Sheet が足りない');
    const newGraphNode = derivedNodeIdOf(newPlain.id);

    // graph node は Sheet の数 (Sheet 1 と index) だけで、どれも新しい Sheet を指す
    expect(
      newMeta.nodes
        .filter(
          (n) => n.properties?.[DERIVED_FROM_SHEET_PROPERTY] !== undefined,
        )
        .map((n) => n.properties?.[DERIVED_FROM_SHEET_PROPERTY])
        .sort(),
    ).toEqual([newPlain.id, newMeta.id].sort());
    expect(newMeta.nodes).toHaveLength(3);
    expect(newMeta.edges.map((e) => e.target)).toEqual([newGraphNode]);
    expect(newMeta.layouts).toEqual([{ nodeId: newGraphNode, x: 10, y: 20 }]);
  });

  test('🔴 template を当てた Sheet は、取り込んだ後も新しい template graph を指す (#327)', () => {
    // 取り込みは Sheet と要素の id を振り直す。template への参照 (`{sheet, at}`)・種別の property 名・
    // その値 (template graph の node / edge の id) を付け替えないと、template が黙って落ちる
    const TPL = '33333333-3333-4333-8333-333333333333';
    const CLAIM = '44444444-4444-4444-8444-444444444444';
    const DATA = '55555555-5555-4555-8555-555555555555';
    const SUPPORTS = '66666666-6666-4666-8666-666666666666';
    const USED_EDGE = '77777777-7777-4777-8777-777777777777';
    const kindOf = (sheetId: string) => kindPropertyOf(templateIdOf(sheetId));
    const raw = payload({
      // 旧版の取り込み (migration) は Sheet の property と templateIds を持たない版から上げる
      version: CONVERSENSUS_FILE_VERSION,
      sheets: [
        {
          id: TPL,
          name: '論証',
          properties: { [SHEET_KIND_PROPERTY]: TEMPLATE_SHEET_KIND },
          nodes: [
            { id: CLAIM, content: '', label: '主張' },
            { id: DATA, content: '', label: 'データ' },
          ],
          edges: [
            { id: SUPPORTS, source: DATA, target: CLAIM, label: '支える' },
          ],
        },
        {
          id: 'ffffffff-0000-4111-8222-333333333333',
          name: '論点',
          // 元の File の actor の切断面。取り込んだ File には無い actor である
          templateIds: [{ sheet: TPL, at: { 'did:plc:alice#dev': 4 } }],
          nodes: [
            {
              id: NODE,
              content: '自由は大事',
              properties: { [kindOf(TPL)]: CLAIM, 章: 1 },
            },
            {
              id: '88888888-8888-4888-8888-888888888888',
              content: '事実',
              properties: { [kindOf(TPL)]: DATA },
            },
          ],
          edges: [
            {
              id: USED_EDGE,
              source: '88888888-8888-4888-8888-888888888888',
              target: NODE,
              properties: { [kindOf(TPL)]: SUPPORTS },
            },
          ],
        },
      ],
    });

    const result = store.importFile(raw);
    if (!result.ok) throw new Error('取り込めなかった');
    const batches = store.getBatches(result.file.id);
    const imported = projectFile(batches, result.file.id);
    const [tpl, used] = imported.sheets;
    if (!tpl || !used) throw new Error('Sheet が足りない');

    const [template] = resolveTemplates(
      used.templateIds,
      batches,
      result.file.id,
    );
    if (!template) throw new Error('template が解決できない');
    expect(template.id).toBe(templateIdOf(tpl.id));
    expect(template.nodeKinds.map((k) => k.label).sort()).toEqual(
      ['データ', '主張'].sort(),
    );

    // 種別は新しい template graph の node / edge を指し、ほかの property はそのまま
    const claim = used.nodes.find((n) => n.content === '自由は大事');
    expect(nodeKindIn(template, claim?.properties)?.label).toBe('主張');
    expect(claim?.properties?.章).toBe(1);
    expect(Object.keys(claim?.properties ?? {})).not.toContain(kindOf(TPL));
    const [edge] = used.edges;
    expect(edge?.properties?.[kindOf(tpl.id)]).toBe(tpl.edges[0]?.id);
  });

  test('形の合わないものは取り込まず、理由を返す', () => {
    const { version: _, ...noVersion } = payload();
    expect(store.importFile(noVersion).ok).toBe(false);
    expect(store.importFile({ ...payload(), sheets: undefined }).ok).toBe(
      false,
    );
    expect(store.listAllFileIds()).toEqual([]);
  });
});

describe('追記と読み出し', () => {
  const FILE = '33333333-3333-4333-8333-333333333333' as FileId;

  test('受信の追記も、自分の編集の追記と同じく op-log に載る', () => {
    store.appendBatches(FILE, [batch('b1', 1)]);
    store.appendReceived(FILE, [batch('b2', 2)]);
    expect(store.getBatches(FILE).map((b) => String(b.id))).toEqual([
      'b1',
      'b2',
    ]);
  });

  test('追記はべき等で、件数は新規分だけ', () => {
    expect(store.appendBatches(FILE, [batch('b1', 1)])).toBe(1);
    expect(store.appendBatches(FILE, [batch('b1', 1), batch('b2', 2)])).toBe(1);
  });

  test('since を渡すと clock がそれより後のものだけ', () => {
    store.appendBatches(FILE, [batch('b1', 1), batch('b2', 2), batch('b3', 3)]);
    expect(store.getBatches(FILE, 1).map((b) => String(b.id))).toEqual([
      'b2',
      'b3',
    ]);
    expect(store.getBatches(FILE).map((b) => String(b.id))).toEqual([
      'b1',
      'b2',
      'b3',
    ]);
  });
});

describe('putBlob / getBlob', () => {
  const PNG = 'image/png';

  test('cid は内容から計算し、同じ内容は同じ cid になる (冪等)', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const first = await store.putBlob(bytes, PNG);
    const second = await store.putBlob(bytes, PNG);
    expect(first).toEqual({
      ok: true,
      blob: { cid: await computeBlobCid(bytes), mimeType: PNG, size: 3 },
    });
    expect(second).toEqual(first);
    expect(store.getBlob(await computeBlobCid(bytes))?.mimeType).toBe(PNG);
  });

  test('画像でないものは受け付けない (daemon の origin で HTML を配らせない)', async () => {
    const result = await store.putBlob(new Uint8Array([1]), 'text/html');
    expect(result).toMatchObject({ ok: false, reason: 'unsupportedType' });
  });

  test('空は受け付けない', async () => {
    const result = await store.putBlob(new Uint8Array(), PNG);
    expect(result).toMatchObject({ ok: false, reason: 'empty' });
  });

  test('PDS の上限を超えるものは断り、上限ちょうどは受け付ける', async () => {
    // 送信時に初めて失敗して outbox に詰まるより、作成時に断る方が分かりやすい
    const over = await store.putBlob(new Uint8Array(MAX_BLOB_SIZE + 1), PNG);
    expect(over).toMatchObject({ ok: false, reason: 'tooLarge' });
    const exact = await store.putBlob(new Uint8Array(MAX_BLOB_SIZE), PNG);
    expect(exact.ok).toBe(true);
  });

  test('無い blob は null (他端末の画像では普通に起こる)', () => {
    expect(
      store.getBlob(
        'bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq',
      ),
    ).toBeNull();
  });
});
