import { describe, expect, it } from 'bun:test';
import {
  type Batch,
  BRANCH_STATUS,
  type BranchMeta,
  type FileId,
  type NodeId,
  projectFile,
  type Sheet,
  type SheetId,
} from '@conversensus/shared';
import {
  type BranchProjectionDeps,
  createBranchOnOplog,
  readBranchSheet,
  readBranchSheets,
} from './branchProjection';

const TRUNK = 'trunk-file' as FileId;
const SHEET = 'sheet-1' as SheetId;
const OTHER_SHEET = 'sheet-2' as SheetId;
const ACTOR = 'did:plc:alice#dev-a';
const SHEET_META = { id: SHEET, name: 'シート1' };

const structure = (id: string, clock: number, sheets: SheetId[]): Batch => ({
  id: id as Batch['id'],
  actor: 'genesis',
  clock,
  timestamp: clock,
  ops: [
    { kind: 'file.setName', name: 'ファイル' },
    ...sheets.map((s) => ({
      kind: 'sheet.create' as const,
      target: s,
      name: `シート ${s}`,
    })),
  ],
});

const content = (
  id: string,
  clock: number,
  ops: Batch['ops'],
  sheetId: SheetId = SHEET,
): Batch => ({
  id: id as Batch['id'],
  actor: ACTOR,
  clock,
  timestamp: clock,
  ops,
  sheetId,
});

const addNode = (node: string, text: string): Batch['ops'][number] => ({
  kind: 'node.add',
  target: node as NodeId,
  content: text,
});

const setContent = (node: string, text: string): Batch['ops'][number] => ({
  kind: 'node.setContent',
  target: node as NodeId,
  content: text,
});

/**
 * Sheet の意味的な指紋。**旧 PDS 経路と op-log 経路は shape が微妙に違う** —
 * `fetchBranchSheetFromPds` は layouts が空なら key ごと省くが、`toSheet` は常に
 * `[]` を置く。UI が許容する差 (trunk 側は W3d-2 で既にこの形) なので、golden 比較は
 * 意味内容 (id 順に正規化した nodes/edges/layouts) で行う。
 */
const fingerprint = (sheet: Sheet) =>
  JSON.stringify({
    id: sheet.id,
    name: sheet.name,
    description: sheet.description,
    nodes: [...sheet.nodes].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...(sheet.edges ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
    layouts: [...(sheet.layouts ?? [])].sort((a, b) =>
      a.nodeId.localeCompare(b.nodeId),
    ),
    edgeLayouts: [...(sheet.edgeLayouts ?? [])].sort((a, b) =>
      a.edgeId.localeCompare(b.edgeId),
    ),
  });

/** file_id → op-log の簡易ストア。fetchBatches はここから引く */
function makeDeps(logs: Record<string, Batch[]>) {
  const saved: BranchMeta[] = [];
  let seq = 0;
  const deps: BranchProjectionDeps = {
    fetchBatches: async (fileId) => logs[fileId] ?? [],
    saveBranch: async (meta) => {
      saved.push(meta);
      return meta;
    },
    newId: () => {
      seq += 1;
      return `id-${seq}`;
    },
  };
  return { deps, saved, logs };
}

describe('createBranchOnOplog', () => {
  const trunkLog = () => [
    structure('t1', 1, [SHEET]),
    content('t2', 2, [addNode('n1', 'trunk ノード1')]),
    content('t3', 3, [addNode('n2', 'trunk ノード2')]),
  ];

  it('base はログ先端 (tipClock) を指す', async () => {
    const { deps } = makeDeps({ [TRUNK]: trunkLog() });
    const meta = await createBranchOnOplog(
      { name: '案A', sheetId: SHEET, trunkFileId: TRUNK, authorActor: ACTOR },
      deps,
    );
    expect(meta.base.at).toBe(3);
    expect(meta.base.authorActor).toBe(ACTOR);
  });

  it('trunk の複製をせず、メタを 1 件保存するだけ', async () => {
    const logs = { [TRUNK]: trunkLog() };
    const { deps, saved } = makeDeps(logs);
    const meta = await createBranchOnOplog(
      { name: '案A', sheetId: SHEET, trunkFileId: TRUNK, authorActor: ACTOR },
      deps,
    );
    // 旧 createBranch は trunk の node/edge/layout を 1 件ずつ PDS へ複製していた。
    // op-log では base を記録するだけで分岐時点を再現できる (設計 §3.4)。
    expect(saved).toEqual([meta]);
    expect(logs[TRUNK]).toHaveLength(3); // trunk op-log は 1 件も増えない
  });

  it('branch 専用 file_id を採番し、branch id と別物にする', async () => {
    const { deps } = makeDeps({ [TRUNK]: trunkLog() });
    const meta = await createBranchOnOplog(
      { name: '案A', sheetId: SHEET, trunkFileId: TRUNK, authorActor: ACTOR },
      deps,
    );
    expect(meta.branchFileId).not.toBe(meta.id as string);
    expect(meta.branchFileId).not.toBe(meta.trunkFileId);
    expect(meta.status).toBe(BRANCH_STATUS.OPEN);
    expect(meta.sheetId).toBe(SHEET);
    expect(meta.trunkFileId).toBe(TRUNK);
  });
});

describe('readBranchSheet', () => {
  /** trunk (分岐時点) → branch 作成 → branch 編集 → trunk 後発編集、の一式を用意する */
  async function setup() {
    const logs: Record<string, Batch[]> = {
      [TRUNK]: [
        structure('t1', 1, [SHEET]),
        content('t2', 2, [addNode('n1', 'trunk ノード1')]),
        content('t3', 3, [
          addNode('n2', 'trunk ノード2'),
          { kind: 'node.setLayout', target: 'n2' as NodeId, x: 10, y: 20 },
        ]),
      ],
    };
    const { deps } = makeDeps(logs);
    const meta = await createBranchOnOplog(
      { name: '案A', sheetId: SHEET, trunkFileId: TRUNK, authorActor: ACTOR },
      deps,
    );
    // branch 側の編集は branch 専用 file_id の op-log へ
    logs[meta.branchFileId] = [
      content('br1', 4, [setContent('n1', 'branch で書き換え')]),
      content('br2', 5, [addNode('n3', 'branch のノード')]),
    ];
    // branch を切った後の trunk 側の編集 (branch には見えないはず)
    logs[TRUNK].push(
      content('t4', 6, [addNode('n4', 'branch 後の trunk 編集')]),
    );
    return { logs, deps, meta };
  }

  it('旧 fetchBranchSheetFromPds と同じ内容になる (golden)', async () => {
    const { deps, meta } = await setup();
    const sheet = await readBranchSheet(meta, SHEET_META, deps);

    // golden = 旧経路の意味論。createBranch が「作成時点の trunk」を複製し、
    // fetchBranchSheetFromPds がその複製へ branch 編集を反映した結果を読む:
    //   n1 = branch で書き換え / n2 = 複製されたまま (layout 込み) / n3 = branch で追加
    // trunk 側の後発編集 (n4) は複製に含まれないので現れない。
    const golden: Sheet = {
      id: SHEET,
      name: 'シート1',
      nodes: [
        { id: 'n1' as NodeId, content: 'branch で書き換え' },
        { id: 'n2' as NodeId, content: 'trunk ノード2' },
        { id: 'n3' as NodeId, content: 'branch のノード' },
      ],
      edges: [],
      layouts: [{ nodeId: 'n2' as NodeId, x: 10, y: 20 }],
      edgeLayouts: [],
    };
    expect(fingerprint(sheet)).toBe(fingerprint(golden));
  });

  it('base より後の trunk 編集は branch に現れない', async () => {
    const { deps, meta } = await setup();
    const sheet = await readBranchSheet(meta, SHEET_META, deps);
    expect(sheet.nodes.map((n) => n.id)).not.toContain('n4');
  });

  // p5-4: hook は「現在 / 分岐点 / 直近コミット時点」を同時に要る。旧経路は分岐点を
  // PDS スナップショットの控えとして React state に抱えていたが、op-log では
  // すべて同じログの切り出しなので保持しない。
  describe('readBranchSheets (3 時点の切り出し)', () => {
    it('base は branch の編集を 1 件も含まない (分岐点そのもの)', async () => {
      const { deps, meta } = await setup();
      const { base } = await readBranchSheets(meta, SHEET_META, deps);
      expect(base.nodes.map((n) => n.content)).toEqual([
        'trunk ノード1',
        'trunk ノード2',
      ]);
    });

    it('atLastCommit はコミット位置までの branch 編集だけを含む', async () => {
      // branch の編集は clock 4 (n1 書き換え) と 5 (n3 追加)。at=4 で切ると後者は入らない。
      const { deps, meta } = await setup();
      const { atLastCommit, current } = await readBranchSheets(
        meta,
        SHEET_META,
        deps,
        { lastCommitAt: 4 },
      );
      expect(atLastCommit.nodes.map((n) => n.id)).not.toContain('n3');
      expect(atLastCommit.nodes.find((n) => n.id === 'n1')?.content).toBe(
        'branch で書き換え',
      );
      // 現在は両方入る (未コミットの n3 が pending として差分に出る)
      expect(current.nodes.map((n) => n.id)).toContain('n3');
    });

    it('コミットが無ければ atLastCommit は base に等しい', async () => {
      const { deps, meta } = await setup();
      const { base, atLastCommit } = await readBranchSheets(
        meta,
        SHEET_META,
        deps,
      );
      expect(fingerprint(atLastCommit)).toBe(fingerprint(base));
    });
  });

  it('branch の編集は trunk の projection を変えない', async () => {
    const { logs, deps, meta } = await setup();
    await readBranchSheet(meta, SHEET_META, deps);
    // branch batch は branch 専用 file_id にしか無いので trunk は無傷
    const trunk = projectFile(logs[TRUNK] ?? [], TRUNK);
    const trunkSheet = trunk.sheets.find((s) => s.id === SHEET);
    expect(trunkSheet?.nodes.map((n) => n.id).sort()).toEqual([
      'n1',
      'n2',
      'n4',
    ]);
    expect(trunkSheet?.nodes.find((n) => n.id === 'n1')?.content).toBe(
      'trunk ノード1', // branch 側の書き換えは漏れていない
    );
  });

  it('シートのメタは引数から与えられる (branch op-log は sheet.create を持たない)', async () => {
    const { deps, meta } = await setup();
    const sheet = await readBranchSheet(
      meta,
      { id: SHEET, name: '別名', description: 'せつめい' },
      deps,
    );
    expect(sheet.name).toBe('別名');
    expect(sheet.description).toBe('せつめい');
  });

  // 🔴 trunk op-log は**ファイル全体 (全シート)** のログ。`projectBatches` は content op を
  // sheetId で仕分けないので、絞らずに渡すと他シートのノードが branch に現れる。
  // 旧 fetchBranchSheetFromPds は sheet 参照でフィルタしていたため、絞らないと
  // golden と一致しない。調整層でシートに絞ることを固定する。
  it('他シートの content は branch に現れない (多シートファイル)', async () => {
    const logs: Record<string, Batch[]> = {
      [TRUNK]: [
        structure('t1', 1, [SHEET, OTHER_SHEET]),
        content('t2', 2, [addNode('n1', 'このシートのノード')]),
        content(
          't3',
          3,
          [addNode('x1', '別シートのノード')],
          OTHER_SHEET, // 別シートの編集
        ),
      ],
    };
    const { deps } = makeDeps(logs);
    const meta = await createBranchOnOplog(
      { name: '案A', sheetId: SHEET, trunkFileId: TRUNK, authorActor: ACTOR },
      deps,
    );
    const sheet = await readBranchSheet(meta, SHEET_META, deps);
    expect(sheet.nodes.map((n) => n.id)).toEqual(['n1']);
  });
});
