import type { ISODateString, Rkey } from '@conversensus/shared';

/**
 * CID キャッシュ: PDS 上の各レコードの最終確認済み CID を追跡する。
 * - 書き込み時 (syncSheetToAtproto) → setCid で更新
 * - ログイン時 (initCidCacheFromPds) → PDS の現在状態で初期化
 * - ポーリング時 (poller.ts) → 新 CID と比較してリモート変更を検出
 */

type CacheEntry = { cid: string; createdAt?: ISODateString };
const _cache = new Map<string, CacheEntry>(); // `${collection}/${rkey}` → entry

function key(collection: string, rkey: Rkey): string {
  return `${collection}/${rkey}`;
}

export function setCid(
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

export function getCid(collection: string, rkey: Rkey): string | undefined {
  return _cache.get(key(collection, rkey))?.cid;
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

export function clearCache(): void {
  _cache.clear();
}
