/**
 * CID キャッシュ: PDS 上の各レコードの最終確認済み CID を追跡する。
 * - 書き込み時 (syncSheetToAtproto) → setCid で更新
 * - ログイン時 (initCidCacheFromPds) → PDS の現在状態で初期化
 * - ポーリング時 (poller.ts) → 新 CID と比較してリモート変更を検出
 */

const _cache = new Map<string, string>(); // `${collection}/${rkey}` → cid

function key(collection: string, rkey: string): string {
  return `${collection}/${rkey}`;
}

export function setCid(collection: string, rkey: string, cid: string): void {
  _cache.set(key(collection, rkey), cid);
}

export function getCid(collection: string, rkey: string): string | undefined {
  return _cache.get(key(collection, rkey));
}

/** AT-URI から collection / rkey を取り出して setCid する */
export function cacheResult(uri: string, cid: string): void {
  // AT-URI: "at://did/collection/rkey"
  const parts = uri.split('/');
  const collection = parts[3];
  const rkey = parts[4];
  if (collection && rkey) setCid(collection, rkey, cid);
}

export function clearCache(): void {
  _cache.clear();
}
