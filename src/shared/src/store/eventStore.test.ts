import { beforeEach, describe, expect, it } from 'bun:test';
import type { Batch, FileId, NodeId, SheetId } from '../index';
import { BunSqliteDriver, IN_MEMORY } from './bunSqliteDriver';
import { EventStore } from './eventStore';

const FILE = 'file-1' as FileId;
const SHEET_META = { id: 'sheet-1' as SheetId, name: 'Sheet 1' };

/**
 * branded id の列を素の文字列として取り出す。
 * 期待値をリテラルで書けるようにするための糖衣で, 比較の意味は変わらない
 */
const idsOf = (records: readonly { id: string }[]): string[] =>
  records.map((r) => r.id as string);

let store: EventStore;

beforeEach(() => {
  store = new EventStore(new BunSqliteDriver(IN_MEMORY));
});

/** node.add 1 件だけの Batch を作るヘルパ */
const addNode = (
  id: string,
  node: string,
  content: string,
  clock: number,
  timestamp = clock,
): Batch => ({
  id: id as Batch['id'],
  actor: 'local',
  clock,
  seq: clock,
  deps: {},
  timestamp,
  ops: [{ kind: 'node.add', target: node as NodeId, content }],
});

describe('EventStore', () => {
  describe('appendBatch / getBatches', () => {
    it('追記した Batch を読み返せる', () => {
      const batch = addNode('b1', 'n1', 'ノード1', 1);
      expect(store.appendBatch(FILE, batch)).toBe(true);
      expect(store.getBatches(FILE)).toEqual([batch]);
    });

    it('同一 batch_id の再追記はべき等 (false を返し重複しない)', () => {
      const batch = addNode('b1', 'n1', 'ノード1', 1);
      expect(store.appendBatch(FILE, batch)).toBe(true);
      expect(store.appendBatch(FILE, batch)).toBe(false);
      expect(store.getBatches(FILE)).toHaveLength(1);
    });

    it('file_id が異なれば同じ batch_id でも共存する', () => {
      const other = 'file-2' as FileId;
      store.appendBatch(FILE, addNode('b1', 'n1', 'A', 1));
      store.appendBatch(other, addNode('b1', 'n1', 'B', 1));
      expect(store.getBatches(FILE)).toHaveLength(1);
      expect(store.getBatches(other)).toHaveLength(1);
    });

    it('clock 昇順で返す (追記順が逆でも)', () => {
      store.appendBatch(FILE, addNode('b2', 'n2', 'B', 2));
      store.appendBatch(FILE, addNode('b1', 'n1', 'A', 1));
      expect(idsOf(store.getBatches(FILE))).toEqual(['b1', 'b2']);
    });

    it('壊れた Batch (ops 空) は追記を拒否する', () => {
      const broken = { ...addNode('b1', 'n1', 'A', 1), ops: [] } as Batch;
      expect(() => store.appendBatch(FILE, broken)).toThrow();
      expect(store.getBatches(FILE)).toHaveLength(0);
    });
  });

  /**
   * merge の写し (step3 Phase 1 D2)。写しは merge した人自身の batch (新しい id) なので、
   * 保存は**追記のみ**に戻った。step2 では同じ id の写しが別の clock で届くと位置を置き換えて
   * いたが、その例外は無くなった。同じ元を指す写しの重複は畳み込み (`orderBatches`) が除く
   */
  describe('merge の写し (step3 Phase 1 D2)', () => {
    const copy = (id: string, clock: number, merger: string): Batch => ({
      ...addNode(id, 'n1', 'branch の編集', clock, 5),
      actor: merger,
      copyOf: { actor: 'did:plc:alice#dev-a', seq: 3 },
      mergedIn: '00000000-0000-4000-8000-00000000c0de' as Batch['mergedIn'],
    });

    it('copyOf / mergedIn を往復する', () => {
      store.appendBatch(FILE, copy('c1', 7, 'did:plc:bob#dev-b'));
      expect(store.getBatches(FILE)).toEqual([
        copy('c1', 7, 'did:plc:bob#dev-b'),
      ]);
    });

    it('同じ元を指す別の写しは、両方とも追記される (除くのは畳み込みの役目)', () => {
      expect(
        store.appendBatch(FILE, copy('c1', 20, 'did:plc:alice#dev-a')),
      ).toBe(true);
      expect(store.appendBatch(FILE, copy('c2', 18, 'did:plc:bob#dev-b'))).toBe(
        true,
      );
      expect(store.getBatches(FILE)).toHaveLength(2);
    });

    it('同じ id は二度追記しない (べき等)', () => {
      store.appendBatch(FILE, copy('c1', 7, 'did:plc:bob#dev-b'));
      expect(store.appendBatch(FILE, copy('c1', 7, 'did:plc:bob#dev-b'))).toBe(
        false,
      );
      expect(store.getBatches(FILE)).toHaveLength(1);
    });
  });

  describe('appendBatches', () => {
    it('複数 Batch を一括追記し、新規件数を返す', () => {
      const inserted = store.appendBatches(FILE, [
        addNode('b1', 'n1', 'A', 1),
        addNode('b2', 'n2', 'B', 2),
      ]);
      expect(inserted).toBe(2);
      expect(store.getBatches(FILE)).toHaveLength(2);
    });

    it('一部が重複していれば新規分のみカウントする', () => {
      store.appendBatch(FILE, addNode('b1', 'n1', 'A', 1));
      const inserted = store.appendBatches(FILE, [
        addNode('b1', 'n1', 'A', 1),
        addNode('b2', 'n2', 'B', 2),
      ]);
      expect(inserted).toBe(1);
      expect(store.getBatches(FILE)).toHaveLength(2);
    });
  });

  describe('sheetId の永続化 (W3c2)', () => {
    const SHEET = 'sheet-9' as SheetId;
    const addNodeInSheet = (
      id: string,
      node: string,
      content: string,
      clock: number,
      sheetId: SheetId,
    ): Batch => ({ ...addNode(id, node, content, clock), sheetId });

    it('content batch の sheetId を round-trip する', () => {
      store.appendBatch(FILE, addNodeInSheet('b1', 'n1', 'A', 1, SHEET));
      expect(store.getBatches(FILE)[0]?.sheetId).toBe(SHEET);
    });

    it('sheetId 無し (structure) batch は sheetId 無しで返る', () => {
      store.appendBatch(FILE, addNode('b1', 'n1', 'A', 1));
      expect(store.getBatches(FILE)[0]?.sheetId).toBeUndefined();
    });
  });

  describe('projectSheet', () => {
    it('操作ログを projection して Sheet を導出する', () => {
      store.appendBatch(FILE, addNode('b1', 'n1', 'ノード1', 1));
      store.appendBatch(FILE, {
        id: 'b2' as Batch['id'],
        actor: 'local',
        clock: 2,
        seq: 2,
        deps: {},
        timestamp: 2,
        ops: [
          { kind: 'node.setContent', target: 'n1' as NodeId, content: '改' },
        ],
      });
      const sheet = store.projectSheet(FILE, SHEET_META);
      expect(sheet.id).toBe(SHEET_META.id);
      expect(sheet.nodes).toHaveLength(1);
      // LWW: 後勝ちで content が更新されている
      expect(sheet.nodes[0]?.content).toBe('改');
    });

    it('空ログでは空の Sheet を返す', () => {
      const sheet = store.projectSheet(FILE, SHEET_META);
      expect(sheet.nodes).toEqual([]);
      expect(sheet.edges).toEqual([]);
    });
  });

  // ANA-127: discovery の既知集合。一覧 (`listOplogFiles`) と違い表示のための除外を
  // 一切しない。ここから削除済みが抜けると「未知ファイル」と判定されて PDS から
  // materialize され、削除が取り消される。
  describe('listAllFileIds (ANA-127)', () => {
    const structureBatch = (id: string, clock: number): Batch => ({
      id: id as Batch['id'],
      actor: 'genesis',
      clock,
      seq: clock,
      deps: {},
      timestamp: clock,
      ops: [
        { kind: 'file.setName', name: 'F' },
        { kind: 'sheet.create', target: 'sheet-1' as SheetId, name: 'S1' },
      ],
    });
    const removedBatch = (id: string, clock: number): Batch => ({
      id: id as Batch['id'],
      actor: 'local',
      clock,
      seq: clock,
      deps: {},
      timestamp: clock,
      ops: [{ kind: 'file.remove' }],
    });

    it('op-log が空なら空配列', () => {
      expect(store.listAllFileIds()).toEqual([]);
    });

    it('削除済みの file_id も含む (一覧からは消えていても)', () => {
      store.appendBatch(FILE, structureBatch('b1', 1));
      store.appendBatch(FILE, removedBatch('b2', 2));
      expect(store.listOplogFiles()).toEqual([]);
      expect(store.listAllFileIds()).toEqual([FILE]);
    });

    it('0 シートの file_id も含む (一覧からは除かれるもの)', () => {
      store.appendBatch(FILE, addNode('b1', 'n1', 'ノード', 1));
      expect(store.listOplogFiles()).toEqual([]);
      expect(store.listAllFileIds()).toEqual([FILE]);
    });

    it('重複せず初出順で返す', () => {
      const other = 'file-2' as FileId;
      store.appendBatch(other, structureBatch('b1', 1));
      store.appendBatch(FILE, structureBatch('b2', 1));
      store.appendBatch(other, structureBatch('b3', 2));
      expect(store.listAllFileIds()).toEqual([other, FILE]);
    });
  });

  describe('listOplogFiles (Phase 4e-2a)', () => {
    /** file 構造 (file.setName + sheet.create) を持つ batch を作るヘルパ */
    const structure = (
      id: string,
      name: string,
      clock: number,
      description?: string,
    ): Batch => ({
      id: id as Batch['id'],
      actor: 'genesis',
      clock,
      seq: clock,
      deps: {},
      timestamp: clock,
      ops: [
        { kind: 'file.setName', name },
        ...(description !== undefined
          ? [{ kind: 'file.setDescription' as const, description }]
          : []),
        { kind: 'sheet.create', target: 'sheet-1' as SheetId, name: 'S1' },
      ],
    });

    it('op-log が空なら空配列を返す', () => {
      expect(store.listOplogFiles()).toEqual([]);
    });

    it('file 構造 op を畳んで name/description を得る', () => {
      store.appendBatch(FILE, structure('b1', 'ファイルA', 1, 'せつめい'));
      expect(store.listOplogFiles()).toEqual([
        { id: FILE, name: 'ファイルA', description: 'せつめい' },
      ]);
    });

    it('構造を持たない (0 シート) file_id は一覧に出さない', () => {
      // genesis の無い孤児 content batch だけの file_id (D-4)。
      // 有効な GraphFile は必ず 1 シート以上 (W3d-2 の読取失敗判定と同じ基準)。
      store.appendBatch(FILE, addNode('b1', 'n1', 'ノード', 1));
      expect(store.listOplogFiles()).toEqual([]);
    });

    // ANA-127: 削除は tombstone であって行の物理削除ではない。一覧から落ちること
    // **と** batches に行が残ることの両方を固定する — 後者が崩れると discovery が
    // 「未知ファイル」と誤判定して PDS から materialize し直す (設計 D1 層 1)。
    describe('削除済みファイルの除外 (ANA-127)', () => {
      const removed = (id: string, clock: number): Batch => ({
        id: id as Batch['id'],
        actor: 'local',
        clock,
        seq: clock,
        deps: {},
        timestamp: clock,
        ops: [{ kind: 'file.remove' }],
      });

      it('file.remove を持つ file_id は一覧に出さない', () => {
        store.appendBatch(FILE, structure('b1', 'ファイルA', 1));
        store.appendBatch(FILE, removed('b2', 2));
        expect(store.listOplogFiles()).toEqual([]);
      });

      it('一覧から消えても batches の行は残る (tombstone を失わない)', () => {
        store.appendBatch(FILE, structure('b1', 'ファイルA', 1));
        store.appendBatch(FILE, removed('b2', 2));
        expect(store.getBatches(FILE)).toHaveLength(2);
      });

      it('削除済みファイルがあっても他のファイルは一覧に残る', () => {
        const other = 'file-2' as FileId;
        store.appendBatch(FILE, structure('b1', '消す方', 1));
        store.appendBatch(FILE, removed('b2', 2));
        store.appendBatch(other, structure('b3', '残る方', 1));
        expect(store.listOplogFiles()).toEqual([{ id: other, name: '残る方' }]);
      });

      it('file.remove の後に編集が来ても復活しない (remove-wins)', () => {
        store.appendBatch(FILE, structure('b1', 'ファイルA', 1));
        store.appendBatch(FILE, removed('b2', 2));
        store.appendBatch(FILE, structure('b3', '後から来た編集', 3));
        expect(store.listOplogFiles()).toEqual([]);
      });
    });

    it('初出順 (file_id ごとの最小 seq) で並ぶ', () => {
      const other = 'file-2' as FileId;
      store.appendBatch(other, structure('b1', '後で snapshot になる方', 1));
      store.appendBatch(FILE, structure('b2', '先に受信した方', 1));
      expect(store.listOplogFiles().map((f) => f.id)).toEqual([other, FILE]);
    });

    // Phase 5 p5-1: branch 専用 file_id (§3.1-B) の op-log がファイル一覧に
    // 漏れないことを固定する。branch は trunk と同じ batches テーブルに同居する
    // ため、除外できないと UI のファイル一覧に branch がファイルとして並ぶ。
    describe('branch op-log の除外 (Phase 5 p5-1)', () => {
      const BRANCH_FILE = 'branch-file-1' as FileId;

      /** branch 側の編集 = 分岐元シートを指す content batch */
      const branchEdit = (id: string, clock: number): Batch => ({
        ...addNode(id, `n-${id}`, `branch の編集 ${id}`, clock),
        sheetId: SHEET_META.id,
      });

      it('content batch だけの branch op-log は一覧に出ない', () => {
        store.appendBatch(FILE, structure('t1', 'trunk', 1));
        store.appendBatch(BRANCH_FILE, branchEdit('br1', 2));
        store.appendBatch(BRANCH_FILE, branchEdit('br2', 3));
        // 除外は明示コードではなく既存の 0 シート除外で自動的に効く (設計 §9.2 / M2):
        // `branchSheet` はシートのメタを引数から受け取る設計なので branch op-log は
        // `sheet.create` を持たず、`projectFile` が content batch を未作成シート扱いで
        // 落として 0 シートになる。
        expect(store.listOplogFiles().map((f) => f.id)).toEqual([FILE]);
      });

      it('branch op-log の中身自体は失われない (一覧に出ないだけ)', () => {
        store.appendBatch(BRANCH_FILE, branchEdit('br1', 2));
        // 一覧から落ちるのは表示上の判断であって、projection の材料は残る。
        // p5-2 の `branchSheet` はここから branchBatches を読む。
        expect(store.listOplogFiles()).toEqual([]);
        expect(idsOf(store.getBatches(BRANCH_FILE))).toEqual(['br1']);
      });

      // 🔴 除外が成り立つ条件そのものを固定する。branch op-log に構造 op
      // (`sheet.create`) が 1 つでも入ると **branch がファイル一覧に現れる**。
      // p5-2 以降の配線は「branch op-log へ構造 op を流さない」を守る必要があり、
      // 破れたらこのテストが赤くなって気づける (破れた場合は明示除外が要る)。
      it('sheet.create が入ると一覧に出てしまう (除外が依存している条件)', () => {
        store.appendBatch(BRANCH_FILE, structure('br1', 'branch', 1));
        expect(store.listOplogFiles().map((f) => f.id)).toEqual([BRANCH_FILE]);
      });
    });
  });
});

// 画像などのバイナリを置く content-addressed ストア (ANA-116 S2)。
// cid はここでは計算せず呼び出し側から受け取る (API 境界の責務) ため、
// テストも「渡した cid が鍵になる」ことを前提に書く。
describe('EventStore: 知らない種類の op (step3 FPR の確認 §5.3)', () => {
  const withOps = (id: string, seq: number, ops: unknown[]): Batch =>
    ({ ...addNode(id, 'n1', 'x', seq), ops }) as unknown as Batch;
  const unknownOp = { kind: 'node.futureThing', target: 'n1' };

  it('読むときに知らない op を落とし、知っている op は効く', () => {
    store.appendBatch(
      FILE,
      withOps('b1', 1, [
        { kind: 'node.add', target: 'n1', content: 'A' },
        unknownOp,
      ]),
    );
    const [batch] = store.getBatches(FILE);
    expect(batch?.ops as unknown[]).toEqual([
      { kind: 'node.add', target: 'n1', content: 'A' },
    ]);
  });

  it('保存の JSON には知らない op がそのまま残る (クライアントを更新したら効く)', () => {
    const driver = new BunSqliteDriver(IN_MEMORY);
    const raw = new EventStore(driver);
    raw.appendBatch(FILE, withOps('b1', 1, [unknownOp]));
    const [row] = driver.all<{ ops_json: string }>(
      'SELECT ops_json FROM batches',
    );
    expect(JSON.parse(row?.ops_json ?? '[]')).toEqual([unknownOp]);
  });

  it('知らない op だけの batch も、ops が空のまま残る (因果の点を歯抜けにしない)', () => {
    store.appendBatch(FILE, addNode('b1', 'n1', 'A', 1));
    store.appendBatch(FILE, withOps('b2', 2, [unknownOp]));
    store.appendBatch(FILE, addNode('b3', 'n2', 'B', 3));
    const batches = store.getBatches(FILE);
    expect(batches.map((b) => [b.seq, b.ops.length])).toEqual([
      [1, 1],
      [2, 0],
      [3, 1],
    ]);
  });
});

describe('EventStore の blob ストア (ANA-116)', () => {
  const CID_A = 'bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq';
  const CID_B = 'bafkreig7jg6oy63mykyfwfiumu3qwxbm3qggzffeidwl7bm2ulq6h7l2ta';
  const HELLO = new TextEncoder().encode('hello');

  it('格納した blob をバイト列・MIME・サイズごと読み返せる', () => {
    expect(store.putBlob(CID_A, HELLO, 'image/png')).toBe(true);
    const got = store.getBlob(CID_A);
    expect(got).not.toBeNull();
    expect(Array.from(got?.bytes ?? [])).toEqual(Array.from(HELLO));
    expect(got?.mimeType).toBe('image/png');
    expect(got?.size).toBe(HELLO.byteLength);
  });

  it('同じ cid の再格納は false を返し、内容は変わらない (冪等)', () => {
    store.putBlob(CID_A, HELLO, 'image/png');
    // 同じ cid = 同じ内容なので、後から来た方を捨てても結果は変わらない
    expect(store.putBlob(CID_A, new Uint8Array([0]), 'image/jpeg')).toBe(false);
    const got = store.getBlob(CID_A);
    expect(Array.from(got?.bytes ?? [])).toEqual(Array.from(HELLO));
    expect(got?.mimeType).toBe('image/png');
  });

  it('cid が違えば別の行として共存する', () => {
    store.putBlob(CID_A, HELLO, 'image/png');
    store.putBlob(CID_B, new Uint8Array([1, 2, 3]), 'image/jpeg');
    expect(store.getBlob(CID_A)?.mimeType).toBe('image/png');
    expect(Array.from(store.getBlob(CID_B)?.bytes ?? [])).toEqual([1, 2, 3]);
  });

  it('無い cid は null', () => {
    expect(store.getBlob(CID_A)).toBeNull();
  });

  it('0x00 を含むバイト列も欠けずに往復する (BLOB 列であることの確認)', () => {
    // TEXT 列に落とすと NUL で切れる。画像は必ず 0x00 を含むので致命的になる
    const bytes = new Uint8Array([0, 1, 0, 255, 0]);
    store.putBlob(CID_A, bytes, 'application/octet-stream');
    expect(Array.from(store.getBlob(CID_A)?.bytes ?? [])).toEqual([
      0, 1, 0, 255, 0,
    ]);
  });
});
