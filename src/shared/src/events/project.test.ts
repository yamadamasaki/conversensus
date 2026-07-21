import { describe, expect, test } from 'bun:test';
import {
  type EdgeId,
  EdgeIdSchema,
  type FileId,
  FileIdSchema,
  type NodeId,
  NodeIdSchema,
  type SheetId,
  SheetIdSchema,
} from '../schemas';
import { projectBatches, projectFile, toSheet } from './project';
import { type Batch, BatchIdSchema, type Op } from './unified';

const nid = (): NodeId => NodeIdSchema.parse(crypto.randomUUID());
const eid = (): EdgeId => EdgeIdSchema.parse(crypto.randomUUID());
const sid = (): SheetId => SheetIdSchema.parse(crypto.randomUUID());
const fid = (): FileId => FileIdSchema.parse(crypto.randomUUID());

function batch(clock: number, ops: Op[], timestamp = clock): Batch {
  return {
    id: BatchIdSchema.parse(crypto.randomUUID()),
    actor: 'local',
    clock,
    timestamp,
    ops,
  };
}

/** sheetId 付きの content batch (グラフ内容 op) */
function contentBatch(clock: number, sheetId: SheetId, ops: Op[]): Batch {
  return { ...batch(clock, ops), sheetId };
}

/** actor を指定した batch (Phase 4d-3 の順序規則テスト用) */
function actorBatch(
  clock: number,
  actor: string,
  ops: Op[],
  timestamp = clock,
): Batch {
  return { ...batch(clock, ops, timestamp), actor };
}

describe('projectBatches', () => {
  test('node.add / edge.add で状態を構築する', () => {
    const a = nid();
    const b = nid();
    const e = eid();
    const g = projectBatches([
      batch(1, [
        { kind: 'node.add', target: a, content: 'A' },
        { kind: 'node.add', target: b, content: 'B' },
        { kind: 'edge.add', target: e, source: a, dest: b },
      ]),
    ]);
    expect(g.nodes.get(a)?.content).toBe('A');
    expect(g.edges.get(e)).toMatchObject({ source: a, target: b });
  });

  test('content は clock 昇順の畳み込みで LWW になる (投入順に依存しない)', () => {
    const a = nid();
    const older = batch(1, [
      { kind: 'node.setContent', target: a, content: 'old' },
    ]);
    const newer = batch(2, [
      { kind: 'node.setContent', target: a, content: 'new' },
    ]);
    const seed = batch(0, [{ kind: 'node.add', target: a, content: 'init' }]);
    // 投入順を入れ替えても clock 順に解決される
    const g = projectBatches([newer, seed, older]);
    expect(g.nodes.get(a)?.content).toBe('new');
  });

  test('node.remove は接続エッジをカスケード削除する', () => {
    const a = nid();
    const b = nid();
    const e = eid();
    const g = projectBatches([
      batch(1, [
        { kind: 'node.add', target: a, content: 'A' },
        { kind: 'node.add', target: b, content: 'B' },
        { kind: 'edge.add', target: e, source: a, dest: b },
      ]),
      batch(2, [{ kind: 'node.remove', target: a }]),
    ]);
    expect(g.nodes.has(a)).toBe(false);
    expect(g.edges.has(e)).toBe(false);
  });

  test('node.setLayout は移動 (x/y) と リサイズ (width/height) を部分更新で合成する', () => {
    const a = nid();
    const g = projectBatches([
      batch(1, [{ kind: 'node.add', target: a, content: 'A' }]),
      batch(2, [{ kind: 'node.setLayout', target: a, x: 10, y: 20 }]),
      batch(3, [{ kind: 'node.setLayout', target: a, width: 100, height: 50 }]),
    ]);
    expect(g.nodeLayouts.get(a)).toMatchObject({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    });
  });

  test('presentation op は presentation マップに入り、意味的な状態に影響しない', () => {
    const e = eid();
    const a = nid();
    const b = nid();
    const g = projectBatches([
      batch(1, [
        { kind: 'node.add', target: a, content: 'A' },
        { kind: 'node.add', target: b, content: 'B' },
        { kind: 'edge.add', target: e, source: a, dest: b },
        { kind: 'edge.setStyle', target: e, style: { stroke: 'red' } },
      ]),
    ]);
    expect(g.presentation.get(e)).toEqual({ stroke: 'red' });
    expect(g.edges.get(e)?.properties).toBeUndefined();
  });

  test('toSheet は projection を Sheet 形式へ変換する', () => {
    const a = nid();
    const sheetId: SheetId = SheetIdSchema.parse(crypto.randomUUID());
    const g = projectBatches([
      batch(1, [
        { kind: 'node.add', target: a, content: 'A' },
        { kind: 'node.setLayout', target: a, x: 1, y: 2 },
      ]),
    ]);
    const sheet = toSheet(g, { id: sheetId, name: 'S' });
    expect(sheet.name).toBe('S');
    expect(sheet.nodes).toHaveLength(1);
    expect(sheet.layouts?.[0]).toMatchObject({ x: 1, y: 2 });
  });
});

describe('projectFile', () => {
  test('file メタ + sheet.create + content を GraphFile へ射影する', () => {
    const fileId = fid();
    const s1 = sid();
    const a = nid();
    const file = projectFile(
      [
        batch(1, [{ kind: 'file.setName', name: 'F' }]),
        batch(2, [{ kind: 'sheet.create', target: s1, name: 'S1' }]),
        contentBatch(3, s1, [{ kind: 'node.add', target: a, content: 'A' }]),
      ],
      fileId,
    );
    expect(file.id).toBe(fileId);
    expect(file.name).toBe('F');
    expect(file.sheets).toHaveLength(1);
    expect(file.sheets[0].name).toBe('S1');
    expect(file.sheets[0].nodes[0].content).toBe('A');
  });

  test('content は sheetId でグルーピングされる', () => {
    const s1 = sid();
    const s2 = sid();
    const a = nid();
    const b = nid();
    const file = projectFile(
      [
        batch(1, [{ kind: 'sheet.create', target: s1, name: 'S1' }]),
        batch(2, [{ kind: 'sheet.create', target: s2, name: 'S2' }]),
        contentBatch(3, s1, [{ kind: 'node.add', target: a, content: 'A' }]),
        contentBatch(4, s2, [{ kind: 'node.add', target: b, content: 'B' }]),
      ],
      fid(),
    );
    const sheet1 = file.sheets.find((s) => s.id === s1);
    const sheet2 = file.sheets.find((s) => s.id === s2);
    expect(sheet1?.nodes.map((n) => n.content)).toEqual(['A']);
    expect(sheet2?.nodes.map((n) => n.content)).toEqual(['B']);
  });

  test('sheet.remove でシートと content が射影から消える', () => {
    const s1 = sid();
    const a = nid();
    const file = projectFile(
      [
        batch(1, [{ kind: 'sheet.create', target: s1, name: 'S1' }]),
        contentBatch(2, s1, [{ kind: 'node.add', target: a, content: 'A' }]),
        batch(3, [{ kind: 'sheet.remove', target: s1 }]),
      ],
      fid(),
    );
    expect(file.sheets).toHaveLength(0);
  });

  test('sheet.reorder が順序を決め、order 外の live シートは createClock 昇順で末尾', () => {
    const s1 = sid();
    const s2 = sid();
    const s3 = sid();
    const file = projectFile(
      [
        batch(1, [{ kind: 'sheet.create', target: s1, name: 'S1' }]),
        batch(2, [{ kind: 'sheet.create', target: s2, name: 'S2' }]),
        batch(3, [{ kind: 'sheet.create', target: s3, name: 'S3' }]),
        // reorder は s3, s1 のみ指定 (s2 は order 外)
        batch(4, [{ kind: 'sheet.reorder', order: [s3, s1] }]),
      ],
      fid(),
    );
    // order 内 (s3, s1) の後に、order 外 live の s2 が createClock 昇順で追加
    expect(file.sheets.map((s) => s.id)).toEqual([s3, s1, s2]);
  });

  test('未作成シートの content batch は無視される (防御)', () => {
    const s1 = sid();
    const ghost = sid();
    const a = nid();
    const b = nid();
    const file = projectFile(
      [
        batch(1, [{ kind: 'sheet.create', target: s1, name: 'S1' }]),
        contentBatch(2, s1, [{ kind: 'node.add', target: a, content: 'A' }]),
        contentBatch(3, ghost, [{ kind: 'node.add', target: b, content: 'B' }]),
      ],
      fid(),
    );
    expect(file.sheets).toHaveLength(1);
    expect(file.sheets[0].nodes.map((n) => n.content)).toEqual(['A']);
  });

  test('sheet.setName / file.setDescription を LWW で反映する', () => {
    const s1 = sid();
    const file = projectFile(
      [
        batch(1, [{ kind: 'file.setName', name: 'F' }]),
        batch(2, [{ kind: 'sheet.create', target: s1, name: 'old' }]),
        batch(3, [{ kind: 'sheet.setName', target: s1, name: 'new' }]),
        batch(4, [{ kind: 'file.setDescription', description: 'desc' }]),
      ],
      fid(),
    );
    expect(file.description).toBe('desc');
    expect(file.sheets[0].name).toBe('new');
  });
});

describe('orderBatches の順序規則 (Phase 4d-3, 設計 §3.2b)', () => {
  test('単一 actor では timestamp を入れ替えても順序が変わらない (退行なしの固定)', () => {
    const a = nid();
    // clock は一意 (tick() の単調増加より同一 actor 内で必ずそうなる) なので
    // 第 2 キーは発動しない。timestamp を逆順にしても clock 順に解決される。
    const g = projectBatches([
      actorBatch(
        3,
        'local',
        [{ kind: 'node.setContent', target: a, content: '3rd' }],
        100,
      ),
      actorBatch(
        1,
        'local',
        [{ kind: 'node.add', target: a, content: '1st' }],
        300,
      ),
      actorBatch(
        2,
        'local',
        [{ kind: 'node.setContent', target: a, content: '2nd' }],
        200,
      ),
    ]);
    expect(g.nodes.get(a)?.content).toBe('3rd');
  });

  test('同一 clock で actor が異なるとき timestamp ではなく actor が順序を決める', () => {
    const a = nid();
    // 端末 A/B が同じ clock を発番する状況は構造的に起きる (設計 §1.1: 同一 snapshot から
    // genesis した端末は同じ連番 clock を seed する)。ここで timestamp を第 2 キーにすると
    // 端末のウォールクロックのずれが順序を左右してしまう。
    const seed = actorBatch(1, 'did:x#dev-a', [
      { kind: 'node.add', target: a, content: 'init' },
    ]);
    // timestamp は dev-b の方が古いが、順序は actor 昇順 (dev-a → dev-b) で決まるので
    // 最後に適用される dev-b が勝つ。
    const fromA = actorBatch(
      2,
      'did:x#dev-a',
      [{ kind: 'node.setContent', target: a, content: 'A' }],
      999,
    );
    const fromB = actorBatch(
      2,
      'did:x#dev-b',
      [{ kind: 'node.setContent', target: a, content: 'B' }],
      1,
    );

    expect(projectBatches([seed, fromA, fromB]).nodes.get(a)?.content).toBe(
      'B',
    );
    // 投入順を入れ替えても同じ結果 (決定論的な全順序)
    expect(projectBatches([fromB, seed, fromA]).nodes.get(a)?.content).toBe(
      'B',
    );
  });

  test('clock も actor も同じときは id が順序を決める', () => {
    const a = nid();
    const seed = actorBatch(1, 'dev', [
      { kind: 'node.add', target: a, content: 'init' },
    ]);
    const x = actorBatch(2, 'dev', [
      { kind: 'node.setContent', target: a, content: 'X' },
    ]);
    const y = actorBatch(2, 'dev', [
      { kind: 'node.setContent', target: a, content: 'Y' },
    ]);
    // id (UUID) の辞書順で後になる方が最後に適用され勝つ
    const expected = x.id.localeCompare(y.id) < 0 ? 'Y' : 'X';
    expect(projectBatches([seed, x, y]).nodes.get(a)?.content).toBe(expected);
    expect(projectBatches([y, x, seed]).nodes.get(a)?.content).toBe(expected);
  });
});

describe('foldFileStructure の現挙動の固定 (Phase 4d-3, 設計 §3.2 / §1.4)', () => {
  // 4d では foldFileStructure を変更しない。順序規則の変更が構造の畳み込みへ
  // どう波及するかを固定し、4e で改善するときの回帰検出点にする。

  test('sheet.setName は比較なしの逐次上書き — 「整列後の最終適用」が勝つ', () => {
    const s1 = sid();
    // clock 比較による LWW ではなく、orderBatches の整列結果で最後に来た op が勝つ。
    // 同一 clock では actor 昇順なので dev-b が勝つ。
    const file = projectFile(
      [
        actorBatch(1, 'dev-a', [
          { kind: 'sheet.create', target: s1, name: 'S' },
        ]),
        actorBatch(
          2,
          'dev-b',
          [{ kind: 'sheet.setName', target: s1, name: 'from-b' }],
          1,
        ),
        actorBatch(
          2,
          'dev-a',
          [{ kind: 'sheet.setName', target: s1, name: 'from-a' }],
          999,
        ),
      ],
      fid(),
    );
    expect(file.sheets[0].name).toBe('from-b');
  });

  test('sheet.reorder は最新が丸ごと勝つ (並行編集で片方の並べ替えが捨てられる)', () => {
    const s1 = sid();
    const s2 = sid();
    // 4e で見直す対象。現時点では「マージせず後勝ち」であることを固定する。
    const file = projectFile(
      [
        actorBatch(1, 'dev-a', [
          { kind: 'sheet.create', target: s1, name: 'S1' },
        ]),
        actorBatch(2, 'dev-a', [
          { kind: 'sheet.create', target: s2, name: 'S2' },
        ]),
        actorBatch(3, 'dev-a', [{ kind: 'sheet.reorder', order: [s2, s1] }]),
        actorBatch(3, 'dev-b', [{ kind: 'sheet.reorder', order: [s1, s2] }]),
      ],
      fid(),
    );
    // 同一 clock なので actor 昇順で dev-b が後、その order が全面採用される
    expect(file.sheets.map((s) => s.id)).toEqual([s1, s2]);
  });
});
