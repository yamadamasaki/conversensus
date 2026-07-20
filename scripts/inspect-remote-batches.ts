/**
 * PDS 上の op-log batch レコードを直接検査する (step1 W3d5-7)
 *
 * 設計 `deepse/plans/step1-w3d5-remote.md` §4.1 (critic A3) の受入基準を機械判定する。
 * **画面に載ったかどうかでは remote 送信を検証できない** — legacy snapshot 経路が肩代わりして
 * 「載ったように見える」偽の確証が起きるため (critic A2)。PDS 上のレコードそのものを見る。
 *
 * 検査項目:
 *   1. genesis 非 push (C1)    — actor='genesis' の batch が 1 件も無いこと
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
  recordToBatch,
} from '../src/client/src/atproto/batchMapper';
import { NSID } from '../src/client/src/atproto/types';

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

/** 1. genesis actor の batch が remote に載っていないこと (C1) */
function checkGenesisNotPushed(batches: Batch[]): Check {
  const genesis = batches.filter((b) => b.actor === GENESIS_ACTOR);
  return {
    name: 'genesis 非 push (C1)',
    ok: genesis.length === 0,
    detail:
      genesis.length === 0
        ? 'genesis actor の batch は 1 件も載っていない'
        : `genesis batch が ${genesis.length} 件載っている: ${genesis
            .map((b) => `${b.id}(clock=${b.clock})`)
            .join(', ')}`,
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
 * **Lamport clock は全体一意を保証しない** — 保証するのは因果順序で、同値の tiebreak は
 * 慣習的に `(clock, actor)` で行う。受信 (import) 経路が無い現状、各端末は自分のローカル
 * 正典からしか seed できないので、別ファイル・別端末の clock は独立に 1 から進む。
 * したがって**別 sheet 間の衝突は multi-device では正常**であり、FAIL にすると
 * device B 検証 (W3d5-7) が常に赤くなる。
 *
 * 一方、**同一 sheet 内の衝突は真の異常**: 同じ編集文脈で採番が重複しており、順序が
 * 決められない。こちらは FAIL のままにする。
 *
 * 注意 (Phase 4d への申し送り): 現状 `actor` は両端末とも `'local'` で端末を識別せず、
 * batch レコードは `fileId` も持たない。よって別 sheet 間の衝突を「別ファイルだから正常」と
 * 判定できるのは sheetId を持つ content batch だけで、file 構造 batch (sheetId 無し) は
 * 区別できない。受信を実装するには actor の端末識別子化と fileId の付与が要る。
 */
function checkClockUnique(batches: Batch[]): Check {
  // 同一 sheet 内の衝突のみを異常とする。sheetId 無し (file 構造 batch) は
  // 宛先を区別する手掛かりが無いので、まとめて 1 つのグループとして扱う。
  const scopeOf = (b: Batch) => `${b.sheetId ?? '(sheet なし)'}#${b.clock}`;
  const byScope = new Map<string, Batch[]>();
  for (const b of batches) {
    const same = byScope.get(scopeOf(b)) ?? [];
    same.push(b);
    byScope.set(scopeOf(b), same);
  }
  const collisions = [...byScope.entries()].filter(([, bs]) => bs.length > 1);

  // 別 sheet 間の衝突は正常だが、起きている事実は表示する (multi-device の証跡)
  const clockCounts = new Map<number, number>();
  for (const b of batches)
    clockCounts.set(b.clock, (clockCounts.get(b.clock) ?? 0) + 1);
  const crossSheet = [...clockCounts.entries()].filter(([, n]) => n > 1);
  const note =
    crossSheet.length > 0
      ? ` (別 sheet 間で clock 重複あり: ${crossSheet
          .map(([clock, n]) => `clock=${clock} に ${n} 件`)
          .join(', ')} — 受信経路が無い現状では正常)`
      : '';

  return {
    name: 'clock 衝突なし (同一 sheet 内)',
    ok: collisions.length === 0,
    detail:
      collisions.length === 0
        ? `同一 sheet 内での clock 重複は無い${note}`
        : `同一 sheet 内で clock が衝突している: ${collisions
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
  const batches: Batch[] = [];
  const invalid: string[] = [];
  for (const r of records) {
    if (!isBatchRecordValue(r.value)) {
      invalid.push(rkeyFromUri(r.uri));
      continue;
    }
    batches.push(recordToBatch(rkeyFromUri(r.uri), r.value));
  }
  batches.sort((a, b) => a.clock - b.clock);

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
    for (const b of batches) {
      console.log(
        `  clock=${String(b.clock).padStart(4)} actor=${b.actor} ` +
          `sheetId=${b.sheetId ?? '(なし)'} ops=[${b.ops.map((o) => o.kind).join(', ')}]`,
      );
    }
  }

  const checks = [
    checkGenesisNotPushed(batches),
    checkNoPresentation(batches),
    checkSheetIdRoundTrip(batches),
    checkClockUnique(batches),
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
