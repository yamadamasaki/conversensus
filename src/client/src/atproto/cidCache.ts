import type { ISODateString, Rkey } from '@conversensus/shared';

/**
 * CID キャッシュ: PDS legacy レコードの createdAt を追跡する。
 *
 * 元はリモート変更のポーリング検出 (CID 比較) のための仕組みだったが、
 * **Phase 6 p6-4 で poller.ts を削除した**ため、残る役目は
 * 「同じデータを再 sync しても createdAt が動かない = CID が変わらない」保証だけ
 * (`sync.ts` の書込側が `getCreatedAt` で参照する)。
 * その sync.ts が退役する p6-5 で、このファイルも消える (設計 §3.8)。
 */

type CacheEntry = { cid: string; createdAt?: ISODateString };
const _cache = new Map<string, CacheEntry>(); // `${collection}/${rkey}` → entry

function key(collection: string, rkey: Rkey): string {
  return `${collection}/${rkey}`;
}

function setCid(
  collection: string,
  rkey: Rkey,
  cid: string,
  createdAt?: ISODateString,
): void {
  const existing = _cache.get(key(collection, rkey));
  _cache.set(key(collection, rkey), {
    cid,
    // 一度キャッシュされた createdAt は変えない (CID 安定性のため)
    createdAt: existing?.createdAt ?? createdAt,
  });
}

/** PDS から読んだ createdAt を返す。なければ undefined */
export function getCreatedAt(
  collection: string,
  rkey: Rkey,
): ISODateString | undefined {
  return _cache.get(key(collection, rkey))?.createdAt;
}

/** AT-URI から collection / rkey を取り出して setCid する */
export function cacheResult(
  uri: string,
  cid: string,
  createdAt?: ISODateString,
): void {
  // AT-URI: "at://did/collection/rkey"
  const parts = uri.split('/');
  const collection = parts[3];
  const rkey = parts[4];
  if (collection && rkey) setCid(collection, rkey, cid, createdAt);
}
