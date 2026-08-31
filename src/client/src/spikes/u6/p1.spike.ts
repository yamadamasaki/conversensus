/**
 * U6-P1 スパイク (投棄前提, 実 PDS を叩く)
 *
 * 問い: **新しい `sheetId` を DtR の器としたとき、他 actor の手元で**
 *   ① 読める
 *   ② 既存 File の projection が壊れない
 *   ③ **File が勝手に増えない** (`discoverRemoteFiles` は未知の fileId を新しい File として
 *      materialize する)
 *
 * 手順: alice が自分の repo に「通常のシート S1」と「DtR の器としての新しいシート S2」を
 * 書き、**bob のセッションで alice の repo を読む**。読み出しは step2 Phase 0 で
 * repo 引数化した経路と同じ形 (`listRecords({ repo: aliceDid })`) を使う。
 *
 * 実行: bun run src/client/src/spikes/u6/p1.spike.ts
 */

import { AtpAgent } from '@atproto/api';
import {
  type Batch,
  type BatchId,
  type FileId,
  projectFile,
  type SheetId,
} from '@conversensus/shared';
import {
  batchRkey,
  batchRkeyFileCursor,
  batchRkeyPrefix,
} from '../../atproto/batchRkey';
import { listBatchFileHeads, listByRkeyPrefix } from '../../atproto/rangeFetch';

const PDS = 'http://localhost:2583';
const PASSWORD = 'devpassword123';
const NSID_BATCH = 'app.conversensus.graph.batch';

const FILE = '9f000000-0000-4000-8000-00000000f11e' as FileId;
const S1 = '9f000000-0000-4000-8000-0000000051a1' as SheetId; // 通常のシート
const S2 = '9f000000-0000-4000-8000-0000000052a2' as SheetId; // DtR の器
const OTHER_FILE = '9f000000-0000-4000-8000-00000000f22e' as FileId; // 対照

let seq = 0;
const bid = () =>
  `9f000000-0000-4000-8000-${String(++seq).padStart(12, '0')}` as BatchId;

function batch(
  actor: string,
  clock: number,
  ops: Batch['ops'],
  sheetId?: SheetId,
): Batch {
  return {
    id: bid(),
    actor,
    clock,
    timestamp: Date.now(),
    ...(sheetId !== undefined && { sheetId }),
    ops,
  };
}

async function login(handle: string): Promise<AtpAgent> {
  const agent = new AtpAgent({ service: PDS });
  await agent.login({ identifier: handle, password: PASSWORD });
  return agent;
}

/** alice が自分の repo へ書く */
async function write(
  agent: AtpAgent,
  fileId: FileId,
  batches: Batch[],
): Promise<string[]> {
  const rkeys: string[] = [];
  for (const b of batches) {
    const rkey = batchRkey(fileId, b.clock, b.id);
    await agent.api.com.atproto.repo.putRecord({
      repo: agent.session?.did ?? '',
      collection: NSID_BATCH,
      rkey,
      record: {
        $type: NSID_BATCH,
        fileId,
        actor: b.actor,
        clock: b.clock,
        timestamp: b.timestamp,
        ...(b.sheetId !== undefined && { sheetId: b.sheetId }),
        ops: b.ops,
      },
    });
    rkeys.push(rkey);
  }
  return rkeys;
}

/** bob が **alice の repo** を読む (Phase 0 で引数化した形と同じ) */
function readerFor(agent: AtpAgent, repo: string) {
  return async (params: {
    cursor?: string;
    reverse?: boolean;
    limit?: number;
  }) => {
    const res = await agent.api.com.atproto.repo.listRecords({
      repo,
      collection: NSID_BATCH,
      limit: params.limit ?? 100,
      cursor: params.cursor,
      reverse: params.reverse,
    });
    return { records: res.data.records, cursor: res.data.cursor };
  };
}

function toBatch(value: unknown, rkey: string): Batch {
  const v = value as Record<string, unknown>;
  const id = rkey.split('~')[3] as BatchId;
  return {
    id,
    actor: v.actor as string,
    clock: v.clock as number,
    timestamp: v.timestamp as number,
    ...(v.sheetId !== undefined && { sheetId: v.sheetId as SheetId }),
    ops: v.ops as Batch['ops'],
  };
}

const results: { n: string; ok: boolean; note: string }[] = [];
const check = (n: string, ok: boolean, note = '') =>
  results.push({ n, ok, note });

async function main() {
  const alice = await login('alice.test');
  const bob = await login('bob.test');
  const aliceDid = alice.session?.did ?? '';
  const bobDid = bob.session?.did ?? '';
  console.log(`alice=${aliceDid}\nbob=${bobDid}\n`);

  // 書く**前**の fileId 集合を取る (③ の対照)
  const before = new Set(
    (await listBatchFileHeads(readerFor(bob, aliceDid))).map((h) => h.fileId),
  );

  // --- alice が書く ---
  const A = `${aliceDid}#dev`;
  const written = await write(alice, FILE, [
    batch(A, 1, [{ kind: 'sheet.create', target: S1, name: '本編' }]),
    batch(
      A,
      2,
      [
        { kind: 'node.add', target: 'n1', content: '通常のノード' },
      ] as Batch['ops'],
      S1,
    ),
    // ★ DtR の器: **同じ fileId の中に新しい sheetId を切る**
    batch(A, 3, [{ kind: 'sheet.create', target: S2, name: 'DtR' }]),
    batch(
      A,
      4,
      [
        { kind: 'node.add', target: 'd1', content: '対話ノード' },
      ] as Batch['ops'],
      S2,
    ),
  ]);
  const writtenOther = await write(alice, OTHER_FILE, [
    batch(A, 1, [{ kind: 'sheet.create', target: S1, name: '別ファイル' }]),
  ]);

  // --- bob が alice の repo を読む ---
  // **本物の範囲取得を使う** (`collections.batches.listByFile` と同じ形)。
  // alice の repo には過去のテストのファイルが多数あるので、1 ページ読みでは届かない
  const read = readerFor(bob, aliceDid);
  const records = await listByRkeyPrefix(
    read,
    batchRkeyPrefix(FILE),
    batchRkeyFileCursor(FILE),
  );
  const batches = records.map((r) =>
    toBatch(r.value, r.uri.split('/').pop() ?? ''),
  );

  // ① 読める
  check(
    '① DtR の器 (新しい sheetId) が他 actor の手元で読める',
    batches.some((b) => b.sheetId === S2),
    `${batches.length} 件取得`,
  );

  // ② 既存 File の projection が壊れない
  const file = projectFile(batches, FILE);
  const s1 = file.sheets.find((s) => s.id === S1);
  const s2 = file.sheets.find((s) => s.id === S2);
  check(
    '② 既存シート S1 の projection が壊れない',
    s1?.nodes.length === 1 && s1.nodes[0]?.content === '通常のノード',
    `S1 のノード数=${s1?.nodes.length}`,
  );
  check(
    '②b DtR の器 S2 も同じ File の 1 シートとして出る',
    s2?.nodes.length === 1 && s2.nodes[0]?.content === '対話ノード',
    `シート数=${file.sheets.length} (${file.sheets.map((s) => s.name).join(', ')})`,
  );

  // ③ File が勝手に増えない
  // alice の repo には過去のテストのファイルが既にあるので、**書く前後の差分**で見る。
  // DtR の器が新しい File として materialize されるなら、ここに 3 つ目が現れる
  const after = new Set((await listBatchFileHeads(read)).map((h) => h.fileId));
  const added = [...after].filter((id) => !before.has(id)).sort();
  check(
    '③ File が増えない (新しい sheetId は fileId を増やさない)',
    added.length === 2 && added.includes(FILE) && added.includes(OTHER_FILE),
    `増えた fileId: ${added.join(', ') || 'なし'} (既存 ${before.size} 件)`,
  );

  // --- 後始末 ---
  for (const rkey of [...written, ...writtenOther])
    await alice.api.com.atproto.repo.deleteRecord({
      repo: aliceDid,
      collection: NSID_BATCH,
      rkey,
    });

  console.log('--- 判定 ---');
  for (const r of results)
    console.log(`${r.ok ? '✅' : '❌'} ${r.n}${r.note ? `  (${r.note})` : ''}`);

  // `process.exit` を使わない (client の tsconfig に node の型が無い)。
  // throw すれば bun run の終了コードが非 0 になる
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0)
    throw new Error(
      `${failed.length} 件の判定が落ちた: ${failed.map((r) => r.n).join(' / ')}`,
    );
}

await main();
