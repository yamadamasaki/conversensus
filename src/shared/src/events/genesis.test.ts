import { describe, expect, test } from 'bun:test';
import {
  type EdgeId,
  EdgeIdSchema,
  type FileId,
  FileIdSchema,
  type GraphFile,
  type NodeId,
  NodeIdSchema,
  type SheetId,
  SheetIdSchema,
} from '../schemas';
import { graphFileToBatches } from './genesis';
import { projectFile } from './project';
import { GENESIS_ACTOR, GENESIS_TIMESTAMP } from './unified';

const fid = (): FileId => FileIdSchema.parse(crypto.randomUUID());
const sid = (): SheetId => SheetIdSchema.parse(crypto.randomUUID());
const nid = (): NodeId => NodeIdSchema.parse(crypto.randomUUID());
const eid = (): EdgeId => EdgeIdSchema.parse(crypto.randomUUID());

function sampleFile(): GraphFile {
  const s1 = sid();
  const s2 = sid();
  const a = nid();
  const b = nid();
  const e = eid();
  return {
    id: fid(),
    name: 'マイファイル',
    description: 'せつめい',
    sheets: [
      {
        id: s1,
        name: 'シート1',
        nodes: [
          { id: a, content: 'A' },
          { id: b, content: 'B', properties: { color: 'red' } },
        ],
        edges: [{ id: e, source: a, target: b, label: 'e1' }],
        layouts: [
          { nodeId: a, x: 10, y: 20 },
          { nodeId: b, x: 30, y: 40, width: 100 },
        ],
        edgeLayouts: [
          {
            edgeId: e,
            pathType: 'step',
            labelOffsetX: 5,
            labelOffsetY: 6,
            style: { stroke: 'blue' },
          },
        ],
      },
      { id: s2, name: 'シート2', nodes: [], edges: [] },
    ],
  };
}

describe('graphFileToBatches (genesis)', () => {
  test('projectFile と round-trip して等価な GraphFile を再構築する', () => {
    const file = sampleFile();
    const batches = graphFileToBatches(file);
    const projected = projectFile(batches, file.id);

    expect(projected.name).toBe(file.name);
    expect(projected.description).toBe(file.description);
    expect(projected.sheets.map((s) => s.id)).toEqual([
      file.sheets[0].id,
      file.sheets[1].id,
    ]);

    const s1 = projected.sheets[0];
    expect([...s1.nodes].map((n) => n.content).sort()).toEqual(['A', 'B']);
    expect(s1.nodes.find((n) => n.content === 'B')?.properties).toEqual({
      color: 'red',
    });
    expect(s1.edges).toHaveLength(1);
    expect(s1.edges[0].label).toBe('e1');
    // presentation (H1): edge style / label offset が保全される
    const el = s1.edgeLayouts?.find(
      (l) => l.edgeId === file.sheets[0].edges[0].id,
    );
    expect(el?.pathType).toBe('step');
  });

  test('presentation (edge style / label offset) が genesis に含まれる (H1)', () => {
    const file = sampleFile();
    const batches = graphFileToBatches(file);
    const ops = batches.flatMap((b) => b.ops);
    expect(ops.some((o) => o.kind === 'edge.setStyle')).toBe(true);
    expect(ops.some((o) => o.kind === 'edge.setLabelOffset')).toBe(true);
  });

  test('空シートは content batch を生成しない (空 ops 禁止)', () => {
    const file = sampleFile();
    const batches = graphFileToBatches(file);
    // 全 batch は非空 ops
    expect(batches.every((b) => b.ops.length > 0)).toBe(true);
    // 空シート (シート2) には sheet.create batch はあるが content batch は無い
    const s2 = file.sheets[1].id;
    const contentForS2 = batches.filter((b) => b.sheetId === s2);
    expect(contentForS2).toHaveLength(0);
  });

  test('全 batch が予約 actor と一意連番 clock を持つ (§3.4)', () => {
    const batches = graphFileToBatches(sampleFile());
    expect(batches.every((b) => b.actor === GENESIS_ACTOR)).toBe(true);
    expect(batches.every((b) => b.timestamp === GENESIS_TIMESTAMP)).toBe(true);
    const clocks = batches.map((b) => b.clock);
    expect(new Set(clocks).size).toBe(clocks.length); // 一意
    expect(clocks).toEqual([...clocks].sort((x, y) => x - y)); // 昇順連番
  });

  test('同一 snapshot からの再 genesis は同一 batch id を返す (べき等)', () => {
    const file = sampleFile();
    const a = graphFileToBatches(file);
    const b = graphFileToBatches(file);
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
  });

  test('ノード順が異なっても batch id は変わらない (canonicalization)', () => {
    const file = sampleFile();
    const shuffled: GraphFile = {
      ...file,
      sheets: file.sheets.map((s) => ({
        ...s,
        nodes: [...s.nodes].reverse(),
        edges: [...s.edges].reverse(),
      })),
    };
    const ids1 = graphFileToBatches(file).map((b) => b.id);
    const ids2 = graphFileToBatches(shuffled).map((b) => b.id);
    expect(ids1).toEqual(ids2);
  });

  test('batch id は Zod uuid フォーマットを満たす', () => {
    const batches = graphFileToBatches(sampleFile());
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(batches.every((b) => uuidRe.test(b.id))).toBe(true);
  });

  // Phase 4e-0 (C1 見直し): genesis が remote に載るようになったため、
  // 異なる snapshot から genesis した 2 系統が混在しても収束することを固定する
  // (4e 設計 §3.1 / critic MED2)。
  describe('異 snapshot 由来の genesis 分岐の収束 (Phase 4e-0)', () => {
    test('内容が異なる snapshot は batch id が食い違う (分岐の前提)', () => {
      const v1 = sampleFile();
      // v2: v1 を編集した snapshot (entity ID は共有、内容だけ変える)
      const v2: GraphFile = {
        ...v1,
        sheets: v1.sheets.map((s, i) =>
          i === 0
            ? {
                ...s,
                nodes: s.nodes.map((n) =>
                  n.content === 'A' ? { ...n, content: 'A 改' } : n,
                ),
              }
            : s,
        ),
      };
      const ids1 = new Set(graphFileToBatches(v1).map((b) => b.id));
      const ids2 = graphFileToBatches(v2).map((b) => b.id);
      // 変更したシートの content batch だけ id が変わる
      expect(ids2.some((id) => !ids1.has(id))).toBe(true);
    });

    test('2 系統の genesis を混ぜても入力順によらず同一結果へ収束し、entity が重複しない', () => {
      const v1 = sampleFile();
      const extra = nid();
      const v2: GraphFile = {
        ...v1,
        sheets: v1.sheets.map((s, i) =>
          i === 0
            ? {
                ...s,
                nodes: [
                  ...s.nodes.map((n) =>
                    n.content === 'A' ? { ...n, content: 'A 改' } : n,
                  ),
                  { id: extra, content: 'C' },
                ],
              }
            : s,
        ),
      };
      const gA = graphFileToBatches(v1);
      const gB = graphFileToBatches(v2);

      // 入力順を入れ替えても projection は一致する (orderBatches の全順序による収束)
      const p1 = projectFile([...gA, ...gB], v1.id);
      const p2 = projectFile([...gB, ...gA], v1.id);
      expect(p1).toEqual(p2);

      // entity ID 共有 (snapshot 経由) により、同じ entity へ収斂し重複を生まない
      const s1 = p1.sheets[0];
      expect(p1.sheets.map((s) => s.id).sort()).toEqual(
        v1.sheets.map((s) => s.id).sort(),
      );
      expect([...s1.nodes].map((n) => n.id).sort()).toEqual(
        [...v1.sheets[0].nodes.map((n) => n.id), extra].sort(),
      );
      expect(s1.edges).toHaveLength(1);
    });
  });
});
