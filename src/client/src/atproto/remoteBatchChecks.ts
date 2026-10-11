/**
 * PDS 上の batch レコードを読み解いて検める部分 (`scripts/inspect-remote-batches.ts` から切り出した)。
 *
 * 通信をしない純関数だけを置き、テストする (`remoteBatchChecks.test.ts`)。スクリプトは
 * `listRecords` で集めて、ここに渡して表示するだけである。**src に置くのは、テスト・型検査・lint の
 * 対象にするためである** — scripts/ はどれの対象でもなかったので、v2 で壊れても誰も気付かなかった
 *
 * **op-log v2 (step3 Phase 1) の形に合わせてある** (#254)。rkey は `<fileId>~<actor>~<seq>` で、
 * id は本文に持つ。以前は v1 の rkey (`v1~<fileId>~<clock>~<batchId>`) を前提にしていたので、
 * v2 に移った後は起動すらしなかった。
 */

import {
  type Batch,
  GENESIS_ACTOR,
  isFileOp,
  isSyncable,
  type Op,
} from '@conversensus/shared';
import {
  isAcceptableRemoteBatch,
  isBatchRecordValue,
  recordToRemoteBatch,
} from './batchMapper';
import { parseBatchRkey, rkeyFromUri } from './batchRkey';
import type { RemoteBatch } from './types';

export type ListedRecord = { uri: string; cid: string; value: unknown };

export type ClassifiedRecords = {
  /** batch として読めたもの (clock 順) */
  remoteBatches: RemoteBatch[];
  /** rkey が v2 の形をしていない (v1 の残骸など) */
  foreign: string[];
  /** rkey は v2 だが、本文が batch として読めない・rkey と食い違う・受け取れない値 */
  invalid: { rkey: string; reason: string }[];
};

/**
 * レコードを、検査できる batch とそれ以外に分ける。**受信経路 (`pullRemoteForFile`) と同じ
 * 基準で分ける** — 検査器が本番と違うものを見ると、赤も緑も証拠にならない。
 *
 * - rkey が `<fileId>~<actor>~<seq>` の形でなければ別物として数える (v1 の残骸は別の collection
 *   に残るはずだが、混ざっていれば数で見えるようにする)
 * - 本文の (fileId, actor, seq) が rkey と一致しなければ読まない。適用先の権威は本文の fileId
 *   で、rkey は索引である。食い違いは書き手の誤りか改ざん
 * - 受け取れない値 (`isAcceptableRemoteBatch`: 語彙・clock の上限) も読まない
 */
export function classifyRecords(records: ListedRecord[]): ClassifiedRecords {
  const remoteBatches: RemoteBatch[] = [];
  const foreign: string[] = [];
  const invalid: { rkey: string; reason: string }[] = [];
  for (const r of records) {
    const rkey = rkeyFromUri(r.uri);
    const point = parseBatchRkey(rkey);
    if (!point) {
      foreign.push(rkey);
      continue;
    }
    if (!isBatchRecordValue(r.value)) {
      invalid.push({ rkey, reason: 'batch レコードの形をしていない' });
      continue;
    }
    const rb = recordToRemoteBatch(r.value);
    if (
      rb.fileId !== point.fileId ||
      rb.batch.actor !== point.actor ||
      rb.batch.seq !== point.seq
    ) {
      invalid.push({
        rkey,
        reason: '本文の (fileId, actor, seq) が rkey と違う',
      });
      continue;
    }
    if (!isAcceptableRemoteBatch(rb.batch)) {
      invalid.push({ rkey, reason: '受け取れない値 (語彙・clock の上限)' });
      continue;
    }
    remoteBatches.push(rb);
  }
  remoteBatches.sort((a, b) => a.batch.clock - b.batch.clock);
  return { remoteBatches, foreign, invalid };
}

export type Check = { name: string; ok: boolean; detail: string };

/**
 * 1. genesis batch が remote に載っていること (Phase 4e-0)。
 *
 * genesis は File の最初の姿 (file.setName, sheet.create, ...) を `GENESIS_ACTOR` の batch 列として
 * 置いたもので、content-addressed なので端末が違っても同じ点 (actor, seq) には同じ id が入る。
 * **v2 では rkey が点 (`<fileId>~genesis~<seq>`) なので、同じ点に 2 つのレコードは並ばない** —
 * v1 の「同じ clock に別の id」という分岐の検査は成り立たなくなった。分岐は同じ rkey への
 * 上書きとして消えるので、ここでは載っているかだけを File ごとに見る。
 * 0 件は FAIL — 4e-0 以降は push されるはずで、bootstrap ギャップが塞がっていない
 * (SYNC_TO_REMOTE 無効か、4e-0 より前のデータ) 可能性がある。
 */
export function checkGenesisPresent(remoteBatches: RemoteBatch[]): Check {
  const name = 'genesis が載っている (4e-0)';
  const files = new Set(remoteBatches.map(({ fileId }) => fileId));
  const withGenesis = new Set(
    remoteBatches
      .filter(({ batch }) => batch.actor === GENESIS_ACTOR)
      .map(({ fileId }) => fileId),
  );
  const missing = [...files].filter((f) => !withGenesis.has(f));
  if (withGenesis.size === 0) {
    return {
      name,
      ok: false,
      detail:
        'genesis batch が 1 件も載っていない (4e-0 以降は push されるはず。' +
        'SYNC_TO_REMOTE の有効化とログイン後の編集を確認すること)',
    };
  }
  // 参加した File は、genesis を作った人の repo にあるのが普通なので、欠けていても FAIL にしない
  return {
    name,
    ok: true,
    detail:
      `genesis のある File ${withGenesis.size} 件` +
      (missing.length > 0
        ? ` (genesis の無い File ${missing.length} 件: ${missing.join(', ')} — ` +
          '参加した File なら genesis は作った人の repo にある)'
        : ''),
  };
}

/** 2. presentation op が remote に載っていないこと (D7) */
export function checkNoPresentation(batches: Batch[]): Check {
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
export function checkSheetIdRoundTrip(batches: Batch[]): Check {
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
export function checkClockUnique(remoteBatches: RemoteBatch[]): Check {
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
