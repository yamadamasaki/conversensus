/**
 * rkey prefix による範囲取得 (step1 Phase 7 p7-2)
 *
 * `com.atproto.repo.listRecords` の cursor 意味論だけを使って「rkey が prefix で始まる
 * レコードだけを読む」走査を組み立てる。設計 `step1-phase7-range-fetch.md` §3.2。
 *
 * **ページ取得を引数で受ける**のは 2 つの理由からである:
 *
 * - `collections.ts` は `getAgent()` の singleton に依存するので、走査の論理をそこに置くと
 *   停止条件とリクエスト数を単体で固定できない (受入基準 §5-2 がそれを求めている)。
 * - この走査は **PDS の cursor 実装の性質**に依存する (契約ではない, §6.1)。合成 cursor が
 *   使えなくなったときに差し替える面をこのファイルに閉じ込める。
 */

/** `listRecords` が返すレコード 1 件分 (repo の list には値と CID しか無い) */
export type RecordSummary = { uri: string; cid: string; value: unknown };

/**
 * `listRecords` の 1 ページ。`cursor` は**最後のレコードの rkey そのもの**である
 * (PDS 実装, 設計 §1.3 / p7-0 で実測)。
 */
export type RecordPage = { records: RecordSummary[]; cursor?: string };

/** 1 ページ取得する関数。`reverse: true` で rkey 昇順 + `rkey > cursor` になる */
export type ListRecordsPage = (params: {
  cursor?: string;
  reverse?: boolean;
}) => Promise<RecordPage>;

/** AT-URI (`at://<did>/<collection>/<rkey>`) の末尾から rkey を取り出す */
function rkeyOf(uri: string): string {
  return uri.split('/').at(-1) ?? uri;
}

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
