/**
 * W3d-4 読み取り cutover end-to-end 検証 (デーモンレベル, step1-w3d-read-cutover.md §5)
 *
 * 実 HTTP ハンドラ (`server.fetch`) + 実 SQLite (`events.db`) + 実 snapshot (`storage.ts`) +
 * クライアント読取関数 `projectFile` を結び、openFile の end-to-end 契約を検証する。
 * ブラウザ GUI の外側 (HTTP 転送より内側) のすべてを実物で通す。
 *
 * ブラウザ目視パス (React Flow 描画・branch トグル・flag off の画面復帰・screenshot) は
 * 別途手動で確認する。本テストは migration→projection の正当性を機械的に固める。
 *
 * 検証項目 (§5 W3d-4 / §6):
 *   1. 既存ファイル (snapshot) が移行を経て projectFile で再現される
 *   2. migration はべき等: 再オープンで同一結果
 *   3. 編集 (batch 追記) → 再オープンで projection に反映
 *   4. snapshot 直読の口は無い (Phase 6 p6-3 で撤去)。移行は snapshot を破壊しない
 *
 * **Phase 6 p6-1 での更新**: snapshot → op-log の変換契機が「読取時の lazy migration」から
 * 「デーモン起動時の一括移行」(Phase 6 設計 §3.1) に移った。seed も実際の運用に合わせ、
 * snapshot を直接置いてから一括移行を通す形にしている。検証している性質は変わらない。
 *
 * **Phase 6 p6-3 での更新**: dual-read 安全弁 (`READ_FROM_OPLOG=false` → `GET /files/:id`)
 * を撤去した (設計 §3.4 / §3.6)。項目 4 は意味を反転させ、「口が無いこと」と
 * 「それでも移行は snapshot を壊していないこと」を固定する。
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type EdgeId,
  type FileId,
  type GraphFile,
  type NodeId,
  projectFile,
  type SheetId,
} from '@conversensus/shared';
import { getEventStore } from './eventStoreServer';
import server from './index';
import { migrateAllFilesToOplog } from './migrateAllToOplog';
import { readFile, writeFile } from './storage';

const fetch = server.fetch;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'conversensus-w3d4-'));
  process.env.DATA_DIR = tmpDir;
});

afterEach(async () => {
  delete process.env.DATA_DIR;
  await rm(tmpDir, { recursive: true, force: true });
});

const u = (n: number): string =>
  `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;

/** 実運用相当の複数シート・ノード・エッジ・レイアウトを持つ snapshot を組む */
function richSnapshot(id: FileId): GraphFile {
  const nodeA = u(1) as NodeId;
  const nodeB = u(2) as NodeId;
  const nodeC = u(3) as NodeId;
  const edgeAB = u(11) as EdgeId;
  return {
    id,
    name: 'W3d-4 e2e',
    description: 'read cutover 検証用',
    sheets: [
      {
        id: u(101) as SheetId,
        name: 'メイン',
        description: 'シート1',
        nodes: [
          { id: nodeA, content: 'A', properties: { color: 'red' } },
          { id: nodeB, content: 'B' },
          { id: nodeC, content: 'C' },
        ],
        edges: [{ id: edgeAB, source: nodeA, target: nodeB, label: 'A→B' }],
        layouts: [
          { nodeId: nodeA, x: 10, y: 20, width: 120, height: 40 },
          { nodeId: nodeB, x: 200, y: 20, width: 120, height: 40 },
          { nodeId: nodeC, x: 100, y: 120, width: 120, height: 40 },
        ],
        edgeLayouts: [{ edgeId: edgeAB, pathType: 'smoothstep' }],
      },
      {
        id: u(102) as SheetId,
        name: 'サブ',
        nodes: [{ id: u(4) as NodeId, content: 'D' }],
        edges: [],
        layouts: [
          { nodeId: u(4) as NodeId, x: 0, y: 0, width: 80, height: 30 },
        ],
        edgeLayouts: [],
      },
    ],
  };
}

/**
 * pre-W3 の既存ファイル (snapshot だけが在り op-log を持たない状態) を置き、
 * デーモン起動時の一括移行 (Phase 6 §3.1) を通す。
 *
 * endpoint を経由せず `writeFile` で直接置くのは、**endpoint 経由では作れない状態**
 * だから — p6-1 以降 `POST /files` は op-log を作るので「snapshot だけが在る」に
 * ならない。これは実際に移行が要る唯一の状況 (Phase 6 より前に作られたファイル) の再現。
 */
async function seedLegacySnapshot(file: GraphFile): Promise<void> {
  await writeFile(file);
  await migrateAllFilesToOplog(getEventStore());
}

async function openViaOplog(fileId: FileId): Promise<GraphFile> {
  const res = await fetch(
    new Request(`http://localhost/files/${fileId}/batches`),
  );
  const batches = await res.json();
  return projectFile(batches, fileId);
}

/** projectFile が GraphFile へ再現する構造フィールドだけを正規化して取り出す */
function structural(f: GraphFile) {
  const byId = (a: { id: string }, b: { id: string }) =>
    a.id.localeCompare(b.id);
  return {
    name: f.name,
    description: f.description,
    sheets: f.sheets.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      nodes: [...s.nodes].sort(byId),
      edges: [...s.edges].sort(byId),
      layouts: [...(s.layouts ?? [])].sort((a, b) =>
        (a.nodeId as string).localeCompare(b.nodeId as string),
      ),
      edgeLayouts: [...(s.edgeLayouts ?? [])].sort((a, b) =>
        (a.edgeId as string).localeCompare(b.edgeId as string),
      ),
    })),
  };
}

describe('W3d-4 read cutover e2e (daemon + projectFile)', () => {
  it('1. 既存 snapshot を開くと migration→projectFile が構造を再現する', async () => {
    const file = richSnapshot(u(900) as FileId);
    await seedLegacySnapshot(file);

    const projected = await openViaOplog(file.id);

    // ファイルメタ・シート順・ノード・エッジ・レイアウトが snapshot と一致
    expect(structural(projected)).toEqual(structural(file));
    // シート順 (メイン → サブ) が保たれる
    expect(projected.sheets.map((s) => s.name)).toEqual(['メイン', 'サブ']);
  });

  it('2. migration はべき等: 再オープンで同一 projection', async () => {
    const file = richSnapshot(u(901) as FileId);
    await seedLegacySnapshot(file);

    const first = await openViaOplog(file.id);
    const second = await openViaOplog(file.id);

    expect(structural(second)).toEqual(structural(first));
  });

  it('3. 編集 (batch 追記) を再オープンで projection に反映する', async () => {
    const file = richSnapshot(u(902) as FileId);
    await seedLegacySnapshot(file);

    // 一度開いて genesis の最大 clock を確認してから、その後に編集を積む
    const before = await fetch(
      new Request(`http://localhost/files/${file.id}/batches`),
    );
    const genesis = await before.json();
    const maxClock = genesis.reduce(
      (m: number, b: { clock: number }) => Math.max(m, b.clock),
      0,
    );

    // nodeA (u(1)) の content を編集する batch を追記
    const edit = {
      id: u(5000),
      actor: 'local',
      clock: maxClock + 1,
      timestamp: Date.now(),
      sheetId: u(101),
      ops: [{ kind: 'node.setContent', target: u(1), content: 'A-edited' }],
    };
    await fetch(
      new Request(`http://localhost/files/${file.id}/batches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([edit]),
      }),
    );

    const projected = await openViaOplog(file.id);
    const nodeA = projected.sheets[0].nodes.find((n) => n.id === u(1));
    expect(nodeA?.content).toBe('A-edited');
  });

  it('4. 🔴 snapshot 直読の口は無い。ただし移行は snapshot を壊さない', async () => {
    const file = richSnapshot(u(903) as FileId);
    await seedLegacySnapshot(file);
    await openViaOplog(file.id);

    // かつての安全弁 (READ_FROM_OPLOG=false 相当) は p6-3 で endpoint ごと消えた
    const res = await fetch(new Request(`http://localhost/files/${file.id}`));
    expect(res.status).toBe(404);

    // 一括移行は snapshot を読むだけで書き換えない。p6-5 の物理削除まで、
    // ディスク上の JSON は seed した内容のまま残る (移行の非破壊性)。
    const onDisk = await readFile(file.id);
    expect(structural(onDisk as GraphFile)).toEqual(structural(file));
  });
});
