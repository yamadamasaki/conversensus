import { beforeEach, describe, expect, test } from 'bun:test';
import { computeBlobCid, MAX_BLOB_SIZE } from '../blob';
import { projectFile } from '../events/project';
import type { Batch } from '../events/unified';
import type { FileId } from '../schemas';
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
  test('既定の名前と 1 枚のシートで作り、genesis の op-log を書く', () => {
    const file = store.createFile({});
    expect(file.name).toBe('無題');
    expect(file.sheets.map((s) => s.name)).toEqual(['Sheet 1']);

    // 作った時点で op-log が正典 — projection が返り値と一致する
    const projected = projectFile(store.getBatches(file.id), file.id);
    expect(projected.name).toBe(file.name);
    expect(projected.sheets.map((s) => s.id)).toEqual(
      file.sheets.map((s) => s.id),
    );
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
