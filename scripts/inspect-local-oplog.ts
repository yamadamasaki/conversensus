/**
 * ローカル正典 (op-log) を直接検査する (step1 Phase 4d-6)
 *
 * 設計 `deepse/plans/step1-phase4d-receive.md` §5 の受入基準を機械判定する。
 * 対になる `inspect-remote-batches.ts` が PDS 側 (送信結果) を見るのに対し、こちらは
 * **端末のローカル正典側 (受信結果)** を見る。受信の検証はこちらが主役になる。
 *
 * 「画面に見える」を証拠にしない (§5) だけでなく、**「op-log に行が増えた」も証拠にしない**。
 * 未知 sheetId 宛の content batch は着地しても無言で projection から落ちるため
 * (§1.10)、基準 6 で落ちた op を直接数える。
 *
 * 検査項目 (§5 の受入基準に対応):
 *   1. 受信着地 (基準 1)     — 自端末以外の actor の batch がローカル op-log にある
 *   2. 適用不能 op 0 件 (基準 6) — 全 op が projection へ効いた
 *   3. べき等 (基準 2)       — --snapshot と併用。2 回目以降、batch 数と projection が不変
 *   4. 正典 marker (基準 2)   — DATA_DIR 指定時。受信済ファイルに marker が立っている
 *   5. 収束 (基準 5)         — PEER_URL 指定時。相手端末と projection が一致する
 *   6. 取りこぼし無し (基準 3) — PDS_URL 指定時。remote の batch がすべてローカルにある
 *
 * 使い方:
 *   # device B のデーモンを検査 (fileId は 1 つだけなら省略可)
 *   bun run scripts/inspect-local-oplog.ts
 *   DAEMON_URL=http://localhost:3001 FILE_ID=<uuid> bun run scripts/inspect-local-oplog.ts
 *
 *   # 収束検査 (A と B の projection 一致)
 *   DAEMON_URL=http://localhost:3000 PEER_URL=http://localhost:3001 \
 *     bun run scripts/inspect-local-oplog.ts
 *
 *   # べき等検査 (1 回目で記録し、再受信させてから 2 回目で比較)
 *   bun run scripts/inspect-local-oplog.ts --snapshot /tmp/b.json
 *
 *   # 取りこぼし検査 + marker 検査
 *   PDS_URL=http://localhost:2583 REPO=alice.test DATA_DIR=./data \
 *     bun run scripts/inspect-local-oplog.ts
 *
 * 注意: `GET /files/:id/batches` は lazy migration を起動しうる。marker が立っていない
 * ファイルを叩くと op-log が作り直される (それ自体が §1.8 の検出になる)。
 */

import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  analyzeApplicability,
  type Batch,
  BatchSchema,
  type FileId,
  GENESIS_ACTOR,
  type GraphFile,
  projectFile,
} from '../src/shared/src/index';
import {
  isBatchRecordValue,
  recordToRemoteBatch,
} from '../src/client/src/atproto/batchMapper';
import { NSID } from '../src/client/src/atproto/types';
import { W3_SCHEMA_VERSION } from '../src/server/src/migrateFileToOplog';

const DEFAULT_DAEMON_URL = 'http://localhost:3000';
/** listRecords の 1 ページあたり取得件数 (PDS 上限は 100) */
const PAGE_LIMIT = 100;
const EVENTS_DB_FILE = 'events.db';

const DAEMON_URL = process.env.DAEMON_URL ?? DEFAULT_DAEMON_URL;
const PEER_URL = process.env.PEER_URL;
const PDS_URL = process.env.PDS_URL;
const REPO = process.env.REPO;
const DATA_DIR = process.env.DATA_DIR;
const FILE_ID = process.env.FILE_ID;

const snapshotArg = process.argv.find((a) => a.startsWith('--snapshot'));
const SNAPSHOT_PATH = snapshotArg?.includes('=')
  ? snapshotArg.split('=')[1]
  : snapshotArg
    ? process.argv[process.argv.indexOf(snapshotArg) + 1]
    : undefined;
const DUMP = process.argv.includes('--dump');

type Check = { name: string; ok: boolean; detail: string };
type Snapshot = { fileId: string; batchCount: number; fingerprint: string };

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `${url} が ${res.status} ${res.statusText} を返した (${await res.text()})`,
    );
  }
  return res.json();
}

/** 検査対象の fileId を決める。FILE_ID 未指定でファイルが 1 つだけならそれを使う */
async function resolveFileId(daemonUrl: string): Promise<FileId> {
  if (FILE_ID !== undefined) return FILE_ID as FileId;
  const files = (await getJson(`${daemonUrl}/files`)) as { id: string }[];
  if (files.length === 1) return files[0]!.id as FileId;
  throw new Error(
    files.length === 0
      ? 'ファイルが 1 件も無い'
      : `ファイルが ${files.length} 件ある。FILE_ID で対象を指定すること:\n  ` +
        files.map((f) => f.id).join('\n  '),
  );
}

async function fetchLocalBatches(
  daemonUrl: string,
  fileId: FileId,
): Promise<Batch[]> {
  const raw = (await getJson(`${daemonUrl}/files/${fileId}/batches`)) as unknown[];
  return raw.map((item) => BatchSchema.parse(item));
}

/**
 * projection の指紋。端末間で比較するため、キー順に依存しない安定した形へ正規化する。
 * presentation (ローカル限定) と layout は同期対象外なので指紋から除く — 含めると
 * 収束していても不一致になる。
 */
function fingerprint(file: GraphFile): string {
  const canonical = {
    name: file.name,
    description: file.description ?? null,
    sheets: file.sheets.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description ?? null,
      nodes: [...s.nodes]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((n) => ({ id: n.id, content: n.content, parentId: n.parentId ?? null })),
      edges: [...s.edges]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.label ?? null,
        })),
    })),
  };
  return Bun.hash(JSON.stringify(canonical)).toString(16);
}

/** 1. 受信着地 (基準 1) — 自端末以外の actor の batch がローカル op-log にあること */
function checkReceived(batches: Batch[]): Check {
  const actors = new Set(
    batches.filter((b) => b.actor !== GENESIS_ACTOR).map((b) => b.actor),
  );
  return {
    name: '受信着地 (基準 1)',
    ok: actors.size >= 2,
    detail:
      actors.size >= 2
        ? `${actors.size} 端末分の actor がローカル op-log にある: ${[...actors].join(', ')}`
        : `actor が ${actors.size} 種類しか無い (${[...actors].join(', ') || 'なし'}) — ` +
          '相手端末の編集が届いていない。両端末で編集してから再実行すること',
  };
}

/** 2. 適用不能 op 0 件 (基準 6, §1.10) */
function checkApplicability(batches: Batch[]): Check {
  const r = analyzeApplicability(batches);
  const warnNote =
    r.warns.length > 0
      ? ` (警告 ${r.warns.length} 件: ${[...new Set(r.warns.map((w) => w.reason))].join(', ')})`
      : '';
  return {
    name: '適用不能 op 0 件 (基準 6)',
    ok: r.drops.length === 0,
    detail:
      r.drops.length === 0
        ? `全 ${r.totalOps} op が projection へ効いた${warnNote}`
        : `${r.totalOps} op 中 ${r.drops.length} 件が projection へ効いていない:\n    ` +
          r.drops
            .slice(0, 10)
            .map(
              (d) =>
                `${d.reason}: ${d.kind} target=${d.target ?? '(なし)'} ` +
                `clock=${d.clock} actor=${d.actor} sheetId=${d.sheetId ?? '(なし)'}`,
            )
            .join('\n    ') +
          (r.drops.length > 10 ? `\n    ... 他 ${r.drops.length - 10} 件` : ''),
  };
}

/** 3. べき等 (基準 2) — 前回記録と batch 数・projection が変わっていないこと */
async function checkIdempotent(
  current: Snapshot,
  path: string,
): Promise<Check> {
  if (!existsSync(path)) {
    await Bun.write(path, JSON.stringify(current, null, 2));
    return {
      name: 'べき等 (基準 2)',
      ok: true,
      detail:
        `現在の状態を ${path} に記録した (batch ${current.batchCount} 件, ` +
        `fingerprint ${current.fingerprint})。再受信させてから同じコマンドを再実行すること`,
    };
  }
  const prev = (await Bun.file(path).json()) as Snapshot;
  const diffs: string[] = [];
  if (prev.batchCount !== current.batchCount) {
    diffs.push(`batch 数 ${prev.batchCount} → ${current.batchCount}`);
  }
  if (prev.fingerprint !== current.fingerprint) {
    diffs.push(`projection ${prev.fingerprint} → ${current.fingerprint}`);
  }
  return {
    name: 'べき等 (基準 2)',
    ok: diffs.length === 0,
    detail:
      diffs.length === 0
        ? `再受信しても batch ${current.batchCount} 件・projection ともに不変`
        : `再受信で状態が変わった: ${diffs.join(', ')}`,
  };
}

/**
 * 4. 正典 marker (基準 2) — 受信済ファイルに marker が立っていること。
 *
 * marker が無いと次の `GET /files/:id/batches` が lazy migration を起動し、
 * `DELETE FROM batches` で受信内容を丸ごと破棄する (§1.8)。この検査は §1.8 の回帰検出。
 */
function checkMarker(dataDir: string, fileId: FileId): Check {
  const path = join(dataDir, EVENTS_DB_FILE);
  if (!existsSync(path)) {
    return { name: '正典 marker (基準 2)', ok: false, detail: `${path} が無い` };
  }
  const db = new Database(path, { readonly: true });
  try {
    const row = db
      .query('SELECT schema_version FROM file_migrations WHERE file_id = ?')
      .get(fileId) as { schema_version: number } | null;
    const version = row?.schema_version ?? null;
    return {
      name: '正典 marker (基準 2)',
      ok: version !== null && version >= W3_SCHEMA_VERSION,
      detail:
        version === null
          ? 'marker が立っていない — 次回の読み取りで lazy migration が受信 batch を破棄する (§1.8)'
          : `marker = ${version} (要求 >= ${W3_SCHEMA_VERSION})`,
    };
  } finally {
    db.close();
  }
}

/** 5. 収束 (基準 5) — 相手端末と projection が一致すること */
async function checkConvergence(
  peerUrl: string,
  fileId: FileId,
  self: string,
): Promise<Check> {
  const peerBatches = await fetchLocalBatches(peerUrl, fileId);
  const peer = fingerprint(projectFile(peerBatches, fileId));
  return {
    name: '収束 (基準 5)',
    ok: peer === self,
    detail:
      peer === self
        ? `${peerUrl} と projection が一致 (fingerprint ${self})`
        : `projection が不一致: 自 ${self} / ${peerUrl} ${peer}`,
  };
}

/** PDS 上の当該ファイル宛 batch を集める (fileId は 4d-1 の RemoteBatch エンベロープから) */
async function fetchRemoteBatchIds(
  pdsUrl: string,
  repo: string,
  fileId: FileId,
): Promise<Set<string>> {
  const ids = new Set<string>();
  let cursor: string | undefined;
  do {
    const url = new URL('/xrpc/com.atproto.repo.listRecords', pdsUrl);
    url.searchParams.set('repo', repo);
    url.searchParams.set('collection', NSID.batch);
    url.searchParams.set('limit', String(PAGE_LIMIT));
    if (cursor) url.searchParams.set('cursor', cursor);
    const body = (await getJson(url.toString())) as {
      records: { uri: string; value: unknown }[];
      cursor?: string;
    };
    for (const r of body.records) {
      if (!isBatchRecordValue(r.value)) continue;
      const rkey = r.uri.split('/').at(-1) ?? r.uri;
      const remote = recordToRemoteBatch(rkey, r.value);
      if (remote.fileId === fileId) ids.add(remote.batch.id as string);
    }
    cursor = body.cursor;
  } while (cursor);
  return ids;
}

/**
 * 6. 取りこぼし無し (基準 3) — remote にある batch がすべてローカルに届いていること。
 * 「受信件数 = 送信件数」の代わりに id の包含で見る (件数一致より強い)。
 */
async function checkNoLoss(
  pdsUrl: string,
  repo: string,
  fileId: FileId,
  batches: Batch[],
): Promise<Check> {
  const remoteIds = await fetchRemoteBatchIds(pdsUrl, repo, fileId);
  const localIds = new Set(batches.map((b) => b.id as string));
  const missing = [...remoteIds].filter((id) => !localIds.has(id));
  return {
    name: '取りこぼし無し (基準 3)',
    ok: missing.length === 0,
    detail:
      remoteIds.size === 0
        ? `PDS 上にこのファイル宛の batch が無い (repo=${repo})`
        : missing.length === 0
          ? `PDS 上の ${remoteIds.size} 件がすべてローカル op-log にある`
          : `${missing.length}/${remoteIds.size} 件が届いていない: ${missing.slice(0, 5).join(', ')}`,
  };
}

async function main(): Promise<void> {
  const fileId = await resolveFileId(DAEMON_URL);
  console.log(`daemon:  ${DAEMON_URL}`);
  console.log(`fileId:  ${fileId}`);

  const batches = await fetchLocalBatches(DAEMON_URL, fileId);
  const projected = projectFile(batches, fileId);
  const self = fingerprint(projected);
  console.log(`batches: ${batches.length} 件`);
  console.log(`projection fingerprint: ${self}\n`);

  if (DUMP) {
    console.log('--- batch 一覧 (clock 順) ---');
    for (const b of [...batches].sort((x, y) => x.clock - y.clock)) {
      console.log(
        `  clock=${String(b.clock).padStart(4)} actor=${b.actor} ` +
          `sheetId=${b.sheetId ?? '(なし)'} ops=[${b.ops.map((o) => o.kind).join(', ')}]`,
      );
    }
    console.log('');
  }

  const checks: Check[] = [checkReceived(batches), checkApplicability(batches)];

  if (SNAPSHOT_PATH !== undefined) {
    checks.push(
      await checkIdempotent(
        { fileId, batchCount: batches.length, fingerprint: self },
        SNAPSHOT_PATH,
      ),
    );
  }
  if (DATA_DIR !== undefined) checks.push(checkMarker(DATA_DIR, fileId));
  if (PEER_URL !== undefined) {
    checks.push(await checkConvergence(PEER_URL, fileId, self));
  }
  if (PDS_URL !== undefined && REPO !== undefined) {
    checks.push(await checkNoLoss(PDS_URL, REPO, fileId, batches));
  }

  console.log('--- 受入基準 (§5) ---');
  for (const c of checks) {
    console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}\n        ${c.detail}`);
  }

  const skipped = [
    SNAPSHOT_PATH === undefined && '基準 2 べき等 (--snapshot <path> で有効)',
    DATA_DIR === undefined && '基準 2 marker (DATA_DIR で有効)',
    PEER_URL === undefined && '基準 5 収束 (PEER_URL で有効)',
    (PDS_URL === undefined || REPO === undefined) &&
      '基準 3 取りこぼし (PDS_URL + REPO で有効)',
  ].filter((s): s is string => typeof s === 'string');
  if (skipped.length > 0) {
    console.log(`\n未実施: ${skipped.join(' / ')}`);
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(
    failed.length === 0
      ? '\n実施した検査はすべて PASS'
      : `\n${failed.length} 件 FAIL: ${failed.map((c) => c.name).join(', ')}`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('検査に失敗:', err instanceof Error ? err.message : err);
  process.exit(1);
});
