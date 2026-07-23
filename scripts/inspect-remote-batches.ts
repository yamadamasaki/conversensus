/**
 * PDS 上の op-log batch レコードを直接検査する (step1 W3d5-7)
 *
 * 設計 `deepse/plans/step1-w3d5-remote.md` §4.1 (critic A3) の受入基準を機械判定する。
 * **画面に載ったかどうかでは remote 送信を検証できない** — legacy snapshot 経路が肩代わりして
 * 「載ったように見える」偽の確証が起きるため (critic A2)。PDS 上のレコードそのものを見る。
 *
 * 検査項目:
 *   1. genesis push・id 収束 (4e-0) — genesis batch が remote に載り、同一 fileId に
 *      複数の genesis id が分岐していないこと (Phase 4e §1.2 MED1)。
 *      旧 C1 (genesis 非 push) は Phase 4e-0 で削除された — genesis は content-addressed
 *      で端末間べき等なので、同一 snapshot 由来なら rkey (= batch id) が一致し dedup される。
 *   2. presentation 非搭載 (D7) — 全 op が isSyncable を通ること
 *   3. sheetId 往復            — content batch が sheetId を持つこと
 *   4. clock 単調・衝突なし     — clock の重複が無いこと
 *
 * device B (2 台目) 上で実行すれば、受入基準 3「別端末が remote から取得できる」の検証も兼ねる:
 *   listRecords で取得したレコードが `recordToBatch` を通って Batch に戻せることを、この
 *   スクリプト自体が確かめている (クライアントの pull と同じ mapper を使う)。
 *
 * 使い方:
 *   bun run scripts/inspect-remote-batches.ts
 *   PDS_URL=http://localhost:2583 REPO=alice.test bun run scripts/inspect-remote-batches.ts
 *   bun run scripts/inspect-remote-batches.ts --dump   # 全 batch を一覧表示
 *
 * listRecords は認証不要 (public) なのでログインは要らない。
 */

// `@conversensus/shared` のワークスペース link は src/*/node_modules にしか無く、
// リポジトリ直下の scripts/ からは解決できないため相対パスで読む。
// (batchMapper 側の同名 import は自身の位置 src/client/ から解決されるので手を入れない)
import {
  type Batch,
  GENESIS_ACTOR,
  isFileOp,
  isSyncable,
  type Op,
} from '../src/shared/src/index';
import {
  isBatchRecordValue,
  recordToRemoteBatch,
} from '../src/client/src/atproto/batchMapper';
import { NSID, type RemoteBatch } from '../src/client/src/atproto/types';

const DEFAULT_PDS_URL = 'http://localhost:2583';
const DEFAULT_REPO = 'alice.test';
/** listRecords の 1 ページあたり取得件数 (PDS 上限は 100) */
const PAGE_LIMIT = 100;

const PDS_URL = process.env.PDS_URL ?? DEFAULT_PDS_URL;
const REPO = process.env.REPO ?? DEFAULT_REPO;
const DUMP = process.argv.includes('--dump');

type ListedRecord = { uri: string; cid: string; value: unknown };

function rkeyFromUri(uri: string): string {
  return uri.split('/').at(-1) ?? uri;
}

/** cursor をたどって batch コレクションの全レコードを取得する */
async function listAllRecords(): Promise<ListedRecord[]> {
  const all: ListedRecord[] = [];
  let cursor: string | undefined;
  do {
    const url = new URL('/xrpc/com.atproto.repo.listRecords', PDS_URL);
    url.searchParams.set('repo', REPO);
    url.searchParams.set('collection', NSID.batch);
    url.searchParams.set('limit', String(PAGE_LIMIT));
    if (cursor) url.searchParams.set('cursor', cursor);

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `listRecords failed: ${res.status} ${res.statusText} (${await res.text()})`,
      );
    }
    const body = (await res.json()) as {
      records: ListedRecord[];
      cursor?: string;
    };
    all.push(...body.records);
    cursor = body.cursor;
  } while (cursor);
  return all;
}

type Check = { name: string; ok: boolean; detail: string };

/**
 * 1. genesis batch が remote に載り、id が収束していること (Phase 4e-0)。
 *
 * genesis は content-addressed (snapshot 内容から決定的に id を導出) なので、同一 snapshot
 * から生成された genesis は端末が違っても id (= rkey) が一致し、PDS 上で 1 レコードに
 * dedup される。同一 fileId に複数の genesis batch が見えたら、float 直列化差などで
 * id が分岐している (§1.2 MED1 の残余リスクが現実化) — FAIL とする。
 * genesis が 0 件の場合も FAIL — 4e-0 以降 push されるはずで、bootstrap ギャップが
 * 塞がっていない (SYNC_TO_REMOTE 無効か、4e-0 より前のデータ) 可能性がある。
 */
function checkGenesisConverged(remoteBatches: RemoteBatch[]): Check {
  const genesis = remoteBatches.filter(
    ({ batch }) => batch.actor === GENESIS_ACTOR,
  );
  if (genesis.length === 0) {
    return {
      name: 'genesis push・id 収束 (4e-0)',
      ok: false,
      detail:
        'genesis batch が 1 件も載っていない (4e-0 以降は push されるはず。' +
        'SYNC_TO_REMOTE の有効化とログイン後の編集を確認すること)',
    };
  }
  const byFile = new Map<string, Batch[]>();
  for (const { fileId, batch } of genesis) {
    const same = byFile.get(fileId) ?? [];
    same.push(batch);
    byFile.set(fileId, same);
  }
  const diverged = [...byFile.entries()].filter(([, bs]) => bs.length > 1);
  return {
    name: 'genesis push・id 収束 (4e-0)',
    ok: diverged.length === 0,
    detail:
      diverged.length === 0
        ? `genesis batch ${genesis.length} 件 (file ${byFile.size} 件) — ` +
          'いずれの file も genesis id は 1 つに収束している'
        : `genesis id が分岐している file がある (§1.2 MED1): ${diverged
            .map(
              ([fileId, bs]) =>
                `${fileId} に ${bs.length} 件 [${bs.map((b) => b.id).join(', ')}]`,
            )
            .join('; ')}`,
  };
}

/** 2. presentation op が remote に載っていないこと (D7) */
function checkNoPresentation(batches: Batch[]): Check {
  const leaked: string[] = [];
  for (const b of batches) {
    const bad = b.ops.filter((op: Op) => !isSyncable(op));
    if (bad.length > 0) {
      leaked.push(`${b.id}: ${bad.map((op) => op.kind).join(', ')}`);
    }
  }
  return {
    name: 'presentation 非搭載 (D7)',
    ok: leaked.length === 0,
    detail:
      leaked.length === 0
        ? '全 batch の全 op が同期対象 (presentation は 1 件も無い)'
        : `presentation op が漏れている:\n    ${leaked.join('\n    ')}`,
  };
}

/**
 * 3. content batch が sheetId を持つこと。
 * file 構造 op のみの batch (sheet.create / file.setName 等) は sheetId を持たないのが正しい。
 */
function checkSheetIdRoundTrip(batches: Batch[]): Check {
  const contentBatches = batches.filter((b) => !b.ops.every(isFileOp));
  const missing = contentBatches.filter((b) => b.sheetId === undefined);
  if (contentBatches.length === 0) {
    return {
      name: 'sheetId 往復',
      ok: false,
      detail:
        'content batch が 1 件も無い (ノード・エッジを編集してから再実行すること)',
    };
  }
  return {
    name: 'sheetId 往復',
    ok: missing.length === 0,
    detail:
      missing.length === 0
        ? `content batch ${contentBatches.length} 件すべてが sheetId を持つ`
        : `sheetId が欠けている content batch が ${missing.length} 件: ${missing
            .map((b) => b.id)
            .join(', ')}`,
  };
}

/**
 * 4. clock の衝突検査。
 *
 * **Lamport clock は全体一意を保証しない** — 保証するのは因果順序で、同値は
 * `clock → actor → id` の全順序 (Phase 4d) で tiebreak される。したがって:
 * - **別ファイル間・別端末 (actor) 間の clock 重複は正常** — 並行編集の証跡であり、
 *   tiebreak で順序が決まる。FAIL にすると multi-device 検証が常に赤くなる。
 * - **同一 file × 同一 sheet × 同一 actor 内の重複は真の異常** — 1 つの端末が同じ
 *   編集文脈で clock を二重採番しており、デーモンのバグを示す。こちらを FAIL にする。
 *
 * batch レコードは fileId を必須で持つ (Phase 4d-1) ので、file 単位でスコープを
 * 区切れる。genesis batch (4e-0 で push 解禁) は file ごとに clock 1.. を独立に
 * 刻むため、fileId で区切らないと複数 file の genesis 同士が誤 FAIL する。
 */
function checkClockUnique(remoteBatches: RemoteBatch[]): Check {
  // 同一 file × 同一 sheet × 同一 actor 内の重複のみを異常とする。
  // sheetId 無し (file 構造 batch) は file 内で 1 つのグループとして扱う。
  const scopeOf = ({ fileId, batch: b }: RemoteBatch) =>
    `${fileId}#${b.sheetId ?? '(sheet なし)'}#${b.actor}#${b.clock}`;
  const byScope = new Map<string, Batch[]>();
  for (const rb of remoteBatches) {
    const same = byScope.get(scopeOf(rb)) ?? [];
    same.push(rb.batch);
    byScope.set(scopeOf(rb), same);
  }
  const collisions = [...byScope.entries()].filter(([, bs]) => bs.length > 1);

  // actor 跨ぎ・file 跨ぎの clock 重複は正常だが、起きている事実は表示する
  // (multi-device 並行編集の証跡)
  const clockCounts = new Map<number, number>();
  for (const { batch: b } of remoteBatches)
    clockCounts.set(b.clock, (clockCounts.get(b.clock) ?? 0) + 1);
  const crossScope = [...clockCounts.entries()].filter(([, n]) => n > 1);
  const note =
    crossScope.length > 0
      ? ` (スコープ跨ぎの clock 重複あり: ${crossScope
          .map(([clock, n]) => `clock=${clock} に ${n} 件`)
          .join(', ')} — tiebreak (clock → actor → id) で順序が決まるので正常)`
      : '';

  return {
    name: 'clock 衝突なし (同一 file × sheet × actor 内)',
    ok: collisions.length === 0,
    detail:
      collisions.length === 0
        ? `同一 file × sheet × actor 内での clock 重複は無い${note}`
        : `同一スコープ内で clock が衝突している: ${collisions
            .map(([scope, bs]) => `${scope} に ${bs.length} 件`)
            .join(', ')}`,
  };
}

async function main(): Promise<void> {
  console.log(`PDS:        ${PDS_URL}`);
  console.log(`repo:       ${REPO}`);
  console.log(`collection: ${NSID.batch}\n`);

  const records = await listAllRecords();

  // クライアントの pull と同じ mapper を通す = 別端末が Batch に戻せることの確認 (受入基準 3)
  const remoteBatches: RemoteBatch[] = [];
  const invalid: string[] = [];
  for (const r of records) {
    if (!isBatchRecordValue(r.value)) {
      invalid.push(rkeyFromUri(r.uri));
      continue;
    }
    remoteBatches.push(recordToRemoteBatch(rkeyFromUri(r.uri), r.value));
  }
  remoteBatches.sort((a, b) => a.batch.clock - b.batch.clock);
  const batches: Batch[] = remoteBatches.map((rb) => rb.batch);

  console.log(
    `レコード ${records.length} 件 → batch ${batches.length} 件に復元` +
      (invalid.length > 0
        ? ` (batch として解釈できないレコード ${invalid.length} 件: ${invalid.join(', ')})`
        : ''),
  );

  if (records.length === 0) {
    console.log(
      '\nレコードが 0 件。ログインして編集したか、SYNC_TO_REMOTE が有効かを確認すること。',
    );
    process.exit(1);
  }

  if (DUMP) {
    console.log('\n--- batch 一覧 (clock 順) ---');
    for (const { fileId, batch: b } of remoteBatches) {
      console.log(
        `  clock=${String(b.clock).padStart(4)} actor=${b.actor} ` +
          `fileId=${fileId} sheetId=${b.sheetId ?? '(なし)'} ` +
          `ops=[${b.ops.map((o) => o.kind).join(', ')}]`,
      );
    }
  }

  const checks = [
    checkGenesisConverged(remoteBatches),
    checkNoPresentation(batches),
    checkSheetIdRoundTrip(batches),
    checkClockUnique(remoteBatches),
  ];

  console.log('\n--- 受入基準 (§4.1) ---');
  for (const c of checks) {
    console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}\n        ${c.detail}`);
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(
    failed.length === 0
      ? '\nすべて PASS'
      : `\n${failed.length} 件 FAIL: ${failed.map((c) => c.name).join(', ')}`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('検査に失敗:', err instanceof Error ? err.message : err);
  process.exit(1);
});
