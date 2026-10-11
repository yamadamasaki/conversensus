/**
 * blob (画像などのバイナリ) の識別と上限 (ANA-116)
 *
 * 識別子は **ATProto の blob CID** に揃える。CIDv1 / raw / sha-256 でバイト列から
 * 決まるので、アップロードより先にローカルで確定できる — これが「未ログインで作った
 * 画像の参照を、後からそのまま PDS へ push できる」ことの根拠である
 * (実測: `deepse/plans/step1-refinement-ana116-image.md` §10)。
 *
 * 同じ値をローカル blob ストア (daemon) の主キーにも使う。ローカルと PDS で
 * 識別子が 1 つに揃うので対応表が要らない。
 */

export type BlobCid = string;
export type MimeType = string;

/**
 * blob の上限。PDS の実測値そのもの (5 MiB ちょうどまで通り、+1 バイトで
 * `request entity too large` になる)。上限は PDS の設定値なので本番と一致するとは
 * 限らない — クライアントはこの値で先に弾いた上で、PDS の応答も拾って表示すること。
 */
export const MAX_BLOB_SIZE = 5 * 1024 * 1024;

// CIDv1 / raw / sha-256 のバイナリ接頭辞: version=1, codec=raw(0x55),
// multihash = sha2-256(0x12) + 長さ 32(0x20)
const CID_PREFIX = [0x01, 0x55, 0x12, 0x20] as const;
const SHA256_BYTES = 32;
/** multibase の接頭辞 'b' = base32 (小文字, パディング無し) */
const MULTIBASE_BASE32 = 'b';
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const BITS_PER_CHAR = 5;
const BITS_PER_BYTE = 8;
const BASE32_MASK = 0b11111;

/** CID の文字数: multibase 1 文字 + ceil((4 + 32) * 8 / 5) 文字 */
export const BLOB_CID_LENGTH = 59;

export function base32lower(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << BITS_PER_BYTE) | byte;
    bits += BITS_PER_BYTE;
    while (bits >= BITS_PER_CHAR) {
      out += BASE32_ALPHABET[(value >>> (bits - BITS_PER_CHAR)) & BASE32_MASK];
      bits -= BITS_PER_CHAR;
    }
  }
  // 端数は 0 で右詰めする (パディング文字は付けない)
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (BITS_PER_CHAR - bits)) & BASE32_MASK];
  }
  return out;
}

/**
 * バイト列から blob CID を計算する。`uploadBlob` が返す CID と必ず一致する。
 *
 * `crypto.subtle` はブラウザにも Bun にもあるので client / server の双方で使える。
 */
export async function computeBlobCid(bytes: Uint8Array): Promise<BlobCid> {
  // 実行時は任意の TypedArray を受け付けるが、型の上では `Uint8Array<ArrayBufferLike>` が
  // `BufferSource` (SharedArrayBuffer 上のビューを除く) に嵌らない。このアプリは
  // SharedArrayBuffer を使わないのでビューをそのまま渡す。`.buffer` に置き換えては
  // ならない — subarray の byteOffset / byteLength を落として別の値を返してしまう。
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer),
  );
  const cid = new Uint8Array(CID_PREFIX.length + SHA256_BYTES);
  cid.set(CID_PREFIX, 0);
  cid.set(digest, CID_PREFIX.length);
  return `${MULTIBASE_BASE32}${base32lower(cid)}`;
}

const BLOB_CID_PATTERN = new RegExp(
  `^${MULTIBASE_BASE32}[a-z2-7]{${BLOB_CID_LENGTH - 1}}$`,
);

/**
 * CID の形をしているか。API 境界で受け取った値の検証に使う
 * (格納済みの blob と一致するかは別問題であり、ここでは見ない)。
 */
export function isBlobCid(value: string): boolean {
  return BLOB_CID_PATTERN.test(value);
}

/**
 * 壊れて保存された blob の参照を直す (#264)。
 *
 * step3 Phase 2 から v1.0.0 の直前まで、他の人が貼った画像の参照は受け手の保存で壊れていた。
 * `@atproto/api` が読んだ blob を `BlobRef` のインスタンス (`ref` は CID のオブジェクト) に変え、
 * それが Worker へ structured clone で渡り、JSON として保存されたためである (PR #244 で止めた)。
 * 保存された形は `{ ref: { code, version, multihash, bytes }, mimeType, size, original }` で、
 * `bytes` は数字の鍵を持つ object になっている。
 *
 * **CID のバイト列はそのまま残っている**ので、受け直さなくても手元で元の形
 * (`{ $type: 'blob', ref: { $link }, mimeType, size }`) に戻せる。CID の文字列は multibase の
 * 'b' + base32 (小文字) である。
 *
 * 値を辿り、壊れた参照だけを置き換えた値を返す。直すものが無ければ**同じ値をそのまま返す**
 * (呼び出し側は `===` で書き直しの要否を判定できる)
 */
export function repairBrokenBlobRefs(value: unknown): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => {
      const r = repairBrokenBlobRefs(v);
      if (r !== v) changed = true;
      return r;
    });
    return changed ? out : value;
  }
  if (typeof value !== 'object' || value === null) return value;
  const repaired = repairOne(value as Record<string, unknown>);
  if (repaired) return repaired;
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const r = repairBrokenBlobRefs(v);
    if (r !== v) changed = true;
    out[k] = r;
  }
  return changed ? out : value;
}

/** 数字の鍵を持つ object (JSON に書かれた Uint8Array) をバイト列に戻す */
function bytesOf(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (typeof value !== 'object' || value === null) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return null;
  const bytes = new Uint8Array(entries.length);
  for (const [k, v] of entries) {
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0 || i >= entries.length) return null;
    if (typeof v !== 'number' || v < 0 || v > 255) return null;
    bytes[i] = v;
  }
  return bytes;
}

/** 壊れた参照 1 つを直す。壊れた参照でなければ null */
function repairOne(v: Record<string, unknown>): Record<string, unknown> | null {
  if (v.$type === 'blob' || typeof v.mimeType !== 'string') return null;
  const ref = v.ref;
  if (typeof ref !== 'object' || ref === null) return null;
  const cid = ref as Record<string, unknown>;
  if (cid.version !== 1 || typeof cid.multihash !== 'object') return null;
  const bytes = bytesOf(cid.bytes);
  if (!bytes) return null;
  return {
    $type: 'blob',
    ref: { $link: `${MULTIBASE_BASE32}${base32lower(bytes)}` },
    mimeType: v.mimeType,
    ...(typeof v.size === 'number' && { size: v.size }),
  };
}
