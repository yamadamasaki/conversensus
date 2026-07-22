import { describe, expect, test } from 'bun:test';
import {
  type EdgeId,
  EdgeIdSchema,
  FileIdSchema,
  type NodeId,
  NodeIdSchema,
  type SheetId,
  SheetIdSchema,
} from '../schemas';
import { analyzeApplicability } from './applicability';
import { projectFile } from './project';
import { type Batch, BatchIdSchema, type Op } from './unified';

const nid = (): NodeId => NodeIdSchema.parse(crypto.randomUUID());
const eid = (): EdgeId => EdgeIdSchema.parse(crypto.randomUUID());
const sid = (): SheetId => SheetIdSchema.parse(crypto.randomUUID());
const fid = () => FileIdSchema.parse(crypto.randomUUID());

function batch(clock: number, ops: Op[], sheetId?: SheetId): Batch {
  return {
    id: BatchIdSchema.parse(crypto.randomUUID()),
    actor: 'did:plc:a#dev1',
    clock,
    timestamp: clock,
    ops,
    ...(sheetId !== undefined && { sheetId }),
  };
}

/** シートを 1 枚作る file batch */
function createSheet(clock: number, sheetId: SheetId): Batch {
  return batch(clock, [{ kind: 'sheet.create', target: sheetId, name: 'S' }]);
}

describe('analyzeApplicability', () => {
  test('健全な batch 列では drop が 0 件で、全 op が applied に数えられる', () => {
    const s = sid();
    const a = nid();
    const b = nid();
    const e = eid();
    const report = analyzeApplicability([
      createSheet(1, s),
      batch(
        2,
        [
          { kind: 'node.add', target: a, content: 'A' },
          { kind: 'node.add', target: b, content: 'B' },
          { kind: 'edge.add', target: e, source: a, dest: b },
        ],
        s,
      ),
      batch(3, [{ kind: 'node.setContent', target: a, content: 'A2' }], s),
    ]);

    expect(report.drops).toEqual([]);
    expect(report.warns).toEqual([]);
    expect(report.totalOps).toBe(5);
    expect(report.appliedOps).toBe(5);
  });

  // 設計 §1.10 の bootstrap ギャップ。受入基準 6 が塞ごうとしている本命のケース。
  test('未知 sheetId 宛の content batch を unknown-sheet として検出する', () => {
    const known = sid();
    const unknown = sid();
    const report = analyzeApplicability([
      createSheet(1, known),
      batch(2, [{ kind: 'node.add', target: nid(), content: 'X' }], unknown),
    ]);

    expect(report.drops).toHaveLength(1);
    expect(report.drops[0]).toMatchObject({
      reason: 'unknown-sheet',
      kind: 'node.add',
      sheetId: unknown,
    });
    expect(report.appliedOps).toBe(1); // sheet.create だけが効いた
  });

  test('sheetId を持たない content batch を no-scope として検出する', () => {
    const report = analyzeApplicability([
      batch(1, [{ kind: 'node.add', target: nid(), content: 'X' }]),
    ]);

    expect(report.drops).toHaveLength(1);
    expect(report.drops[0]).toMatchObject({ reason: 'no-scope' });
  });

  test('対象不在の setter を missing-target として検出する', () => {
    const s = sid();
    const report = analyzeApplicability([
      createSheet(1, s),
      batch(2, [{ kind: 'node.setContent', target: nid(), content: 'X' }], s),
      batch(3, [{ kind: 'edge.setLabel', target: eid(), label: 'L' }], s),
    ]);

    expect(report.drops.map((d) => d.reason)).toEqual([
      'missing-target',
      'missing-target',
    ]);
  });

  test('op 時点で対象が存在すれば、後で削除されても missing-target にしない', () => {
    const s = sid();
    const a = nid();
    const report = analyzeApplicability([
      createSheet(1, s),
      batch(2, [{ kind: 'node.add', target: a, content: 'A' }], s),
      batch(3, [{ kind: 'node.setContent', target: a, content: 'A2' }], s),
      batch(4, [{ kind: 'node.remove', target: a }], s),
    ]);

    expect(report.drops).toEqual([]);
  });

  test('node.remove のカスケードで消えたエッジへの setter は missing-target になる', () => {
    const s = sid();
    const a = nid();
    const b = nid();
    const e = eid();
    const report = analyzeApplicability([
      createSheet(1, s),
      batch(
        2,
        [
          { kind: 'node.add', target: a, content: 'A' },
          { kind: 'node.add', target: b, content: 'B' },
          { kind: 'edge.add', target: e, source: a, dest: b },
        ],
        s,
      ),
      batch(3, [{ kind: 'node.remove', target: a }], s),
      batch(4, [{ kind: 'edge.setLabel', target: e, label: 'L' }], s),
    ]);

    expect(report.drops).toHaveLength(1);
    expect(report.drops[0]).toMatchObject({
      reason: 'missing-target',
      kind: 'edge.setLabel',
    });
  });

  test('対象不在の layout/style は drop ではなく orphan-decoration の警告にする', () => {
    const s = sid();
    const report = analyzeApplicability([
      createSheet(1, s),
      batch(2, [{ kind: 'node.setLayout', target: nid(), x: 1, y: 2 }], s),
    ]);

    expect(report.drops).toEqual([]);
    expect(report.warns).toHaveLength(1);
    expect(report.warns[0]).toMatchObject({ reason: 'orphan-decoration' });
    expect(report.appliedOps).toBe(2); // 落ちてはいない
  });

  test('存在しない対象への remove は redundant-remove の警告にとどめる', () => {
    const s = sid();
    const report = analyzeApplicability([
      createSheet(1, s),
      batch(2, [{ kind: 'node.remove', target: nid() }], s),
    ]);

    expect(report.drops).toEqual([]);
    expect(report.warns.map((w) => w.reason)).toEqual(['redundant-remove']);
  });

  test('未作成シートへの sheet.setName を unknown-sheet として検出する', () => {
    const report = analyzeApplicability([
      batch(1, [{ kind: 'sheet.setName', target: sid(), name: 'N' }]),
    ]);

    expect(report.drops).toHaveLength(1);
    expect(report.drops[0]).toMatchObject({
      reason: 'unknown-sheet',
      kind: 'sheet.setName',
    });
  });

  // 最終 live 集合で判定すると誤検出するケース: 作成 → 改名 → 削除。
  // 改名は畳み込みの途中では確かに効いている。
  test('後で削除されるシートへの sheet.setName は drop にしない', () => {
    const s = sid();
    const report = analyzeApplicability([
      createSheet(1, s),
      batch(2, [{ kind: 'sheet.setName', target: s, name: 'N' }]),
      batch(3, [{ kind: 'sheet.remove', target: s }]),
    ]);

    expect(report.drops).toEqual([]);
    expect(report.warns).toEqual([]);
  });

  test('batch の並び順によらない — clock 昇順に整列してから判定する', () => {
    const s = sid();
    const a = nid();
    const ordered = [
      createSheet(1, s),
      batch(2, [{ kind: 'node.add', target: a, content: 'A' }], s),
      batch(3, [{ kind: 'node.setContent', target: a, content: 'A2' }], s),
    ];
    const shuffled = [ordered[2], ordered[0], ordered[1]] as Batch[];

    expect(analyzeApplicability(shuffled).drops).toEqual([]);
  });

  /**
   * このモジュールは `projectFile` の畳み込み規則を写した第 2 の実装なので、
   * 「drop があるときは実際に projection から内容が消えている」ことを実物で裏取りする。
   */
  test('unknown-sheet の drop は projectFile の結果からも実際に消えている', () => {
    const known = sid();
    const unknown = sid();
    const lost = nid();
    const batches = [
      createSheet(1, known),
      batch(2, [{ kind: 'node.add', target: lost, content: 'LOST' }], unknown),
    ];

    const file = projectFile(batches, fid());
    const allNodes = file.sheets.flatMap((sheet) => sheet.nodes);

    expect(allNodes.find((n) => n.id === lost)).toBeUndefined();
    expect(analyzeApplicability(batches).drops).toHaveLength(1);
  });
});
