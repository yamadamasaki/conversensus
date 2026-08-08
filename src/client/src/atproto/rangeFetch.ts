/**
 * batch コレクションの範囲取得 (step1 Phase 7 p7-2 / p7-3)
 *
 * `com.atproto.repo.listRecords` の cursor 意味論だけを使って 2 つの走査を組み立てる。
 * 設計 `step1-phase7-range-fetch.md` §3.2 / §3.3。
 *
 * - `listByRkeyPrefix`: rkey が prefix で始まるレコードだけを読む (= 1 ファイル分)。
 * - `listBatchFileHeads`: 存在する fileId を 1 ファイル 1 リクエストで降順に列挙する。
 *
 * **ページ取得を引数で受ける**のは 2 つの理由からである:
 *
 * - `collections.ts` は `getAgent()` の singleton に依存するので、走査の論理をそこに置くと
 *   停止条件とリクエスト数を単体で固定できない (受入基準 §5-2 がそれを求めている)。
 * - この走査は **PDS の cursor 実装の性質**に依存する (契約ではない, §6.1)。合成 cursor が
 *   使えなくなったときに差し替える面をこのファイルに閉じ込める。
 */

import type { FileId } from '@conversensus/shared';
import {
  batchRkeyFileCursor,
  parseBatchRkey,
  RKEY_VERSION_PREFIX,
} from './batchRkey';

/** `listRecords` が返すレコード 1 件分 (repo の list には値と CID しか無い) */
export type RecordSummary = { uri: string; cid: string; value: unknown };

/**
 * `listRecords` の 1 ページ。`cursor` は**最後のレコードの rkey そのもの**である
 * (PDS 実装, 設計 §1.3 / p7-0 で実測)。
 */
export type RecordPage = { records: RecordSummary[]; cursor?: string };

/**
 * 1 ページ取得する関数。`reverse: true` で rkey 昇順 + `rkey > cursor`、
 * 省略で rkey 降順 + `rkey < cursor` になる。`limit` 省略時は実装既定 (PDS 上限の 100)。
 */
export type ListRecordsPage = (params: {
  cursor?: string;
  reverse?: boolean;
  limit?: number;
}) => Promise<RecordPage>;

/** AT-URI (`at://<did>/<collection>/<rkey>`) の末尾から rkey を取り出す */
function rkeyOf(uri: string): string {
  return uri.split('/').at(-1) ?? uri;
}

/**
 * ファイル列挙のリクエスト数上限 (step1 Phase 7 p7-3)。
 *
 * 正常なら**リクエスト数 = ファイル数 + 1** に収まる (§3.3)。したがって上限超過は
 * 「rkey 順序の前提が崩れた」ことの検知器である — 静かに何百回も回させない (§3.6)。
 * 個人利用のファイル数は 1〜数十のオーダーなので、この値には十分な余裕がある。
 */
export const MAX_FILE_ENUMERATION_REQUESTS = 200;

/**
 * rkey が `prefix` で始まるレコードだけを **rkey 昇順**で取得する。
 *
 * 成立の根拠 (いずれも p7-0 で実機確認済, 設計 §5.1):
 * - `reverse: true` は rkey 昇順 + `rkey > cursor`。`seekCursor` は `prefix` から末尾の
 *   区切りを落とした値なので `prefix…` のどれよりも小さく、かつ 1 つ小さいファイルの
 *   どのレコードよりも大きい → **対象の先頭レコードに着地する**。
 * - fileId は UUID 固定長なので、ある fileId が別の fileId の prefix になることはない。
 *   よって同一 prefix のレコード群は rkey 空間で**連続**する。
 * - したがって **prefix を外れた 1 件を見た時点で走査を終えられる**。この 1 件の読み過ぎは
 *   正常動作なので異常として数えない (§3.6)。
 * - 旧 rkey (hex UUID) はすべて `v1~…` より小さいので、この昇順走査には現れない (§3.1)。
 */
export async function listByRkeyPrefix(
  listPage: ListRecordsPage,
  prefix: string,
  seekCursor: string,
): Promise<RecordSummary[]> {
  const found: RecordSummary[] = [];
  let cursor = seekCursor;
  for (;;) {
    const page = await listPage({ cursor, reverse: true });
    // 空ページで cursor だけ返ると cursor が前進せず無限ループになる。前進する材料が
    // 無い時点で打ち切る — 静かに回り続ける経路を作らない (§3.6)。
    if (page.records.length === 0) return found;
    for (const record of page.records) {
      if (!rkeyOf(record.uri).startsWith(prefix)) return found;
      found.push(record);
    }
    if (!page.cursor) return found;
    cursor = page.cursor;
  }
}

/**
 * 列挙で 1 ファイルにつき着地した 1 レコード (ANA-127 S3)。
 *
 * `head` は**そのファイルの最大 rkey = 最大 clock の batch レコード**である (下記の走査)。
 * 列挙は fileId を知るためだけに読んでいたが、着地レコードそのものを返せば
 * **リクエストを 1 件も増やさずに**「このファイルは削除済みか」を判定できる
 * (削除は最大 clock の tombstone として置かれる, `sync/fileDeletion.ts`)。
 *
 * 解釈 (レコード → Batch → `isFileDeleted`) はここではやらない。このファイルは
 * cursor の意味論だけを持ち、レコード内容の解釈は `atprotoSyncProvider` に置く。
 */
export type BatchFileHead = { fileId: FileId; head: RecordSummary };

/**
 * batch コレクションに存在する fileId を**降順に 1 ファイル 1 リクエストで**列挙する
 * (step1 Phase 7 p7-3, 設計 §3.3)。
 *
 * 合成 cursor に依存する 2 つ目の関数 (§6.1 の緩和 b)。手順:
 *
 * 1. rkey **降順** (`reverse` 省略) で 1 件だけ取る。着地するのは最大の rkey。
 * 2. その rkey から fileId を取り出す。
 * 3. cursor を `v1~<fileId>` にする → 降順は `rkey < cursor` なので、**そのファイルの
 *    全レコードを一気に飛ばし**、1 つ小さい fileId の最終レコードに着地する。
 * 4. `v1~` で始まらない rkey に落ちたら旧 rkey 領域なので終わり (新形式は尽きた)。
 *
 * **リクエスト数 = ファイル数 + 1** で、各 1 レコードしか転送しない。旧レコードは
 * `v1~` より小さいので **1 件見るだけで走査が終わる** (§3.1 の分離が効くのはここ)。
 *
 * 代替案 (不採用) だったファイル索引コレクションは、書込経路が増えて batch op-log との
 * 整合を取る責務が生まれるため採らなかった (§3.3)。p7-0 で cursor seek が実機で
 * 成立したので、fallback として設計に温存するだけでよい。
 */
export async function listBatchFileHeads(
  listPage: ListRecordsPage,
  maxRequests: number = MAX_FILE_ENUMERATION_REQUESTS,
): Promise<BatchFileHead[]> {
  const heads: BatchFileHead[] = [];
  const seen = new Set<FileId>();
  let cursor: string | undefined;
  let malformed = 0;

  for (let requests = 0; requests < maxRequests; requests += 1) {
    const page = await listPage({ cursor, limit: 1 });
    const record = page.records[0];
    if (!record) break; // レコードが尽きた

    const rkey = rkeyOf(record.uri);
    if (!rkey.startsWith(RKEY_VERSION_PREFIX)) break; // 旧 rkey 領域 = 新形式は尽きた

    const parsed = parseBatchRkey(rkey);
    if (!parsed) {
      // `v1~` で始まるのに割れない = 壊れたレコード。飛ばす cursor が作れないので
      // その 1 件だけを跨いで進む (数えて後で警告する, §3.6)。
      malformed += 1;
      cursor = rkey;
      continue;
    }

    if (seen.has(parsed.fileId)) {
      // 同じ fileId に 2 度着地するのは rkey 順序の前提が崩れている証拠。
      // 進めても同じ場所を回るだけなので止める (無言で回り続けない, §3.6)。
      console.warn(
        `[atproto] file enumeration revisited ${parsed.fileId} — rkey ordering ` +
          'assumption broken; stopping enumeration',
      );
      break;
    }
    seen.add(parsed.fileId);
    heads.push({ fileId: parsed.fileId, head: record });
    cursor = batchRkeyFileCursor(parsed.fileId);
  }

  if (malformed > 0) {
    console.warn(
      `[atproto] file enumeration skipped ${malformed} record(s): rkey starts ` +
        "with 'v1~' but does not parse as v1~<fileId>~<clock>~<batchId>",
    );
  }
  if (heads.length >= maxRequests) {
    // 上限に張り付いた = ファイル数 + 1 で収まる前提が崩れている (§3.6 の検知器)
    console.warn(
      `[atproto] file enumeration hit the request cap (${maxRequests}); ` +
        'the file list may be incomplete',
    );
  }
  return heads;
}
