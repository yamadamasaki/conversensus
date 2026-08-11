import { describe, expect, test } from 'bun:test';
import {
  BLOB_CID_LENGTH,
  computeBlobCid,
  isBlobCid,
  MAX_BLOB_SIZE,
} from './blob';

// 実機 PDS (infra/pds) の uploadBlob が実際に返した値。
// この 2 件が一致する限り、ローカル計算した CID をそのまま PDS の識別子として使える。
const PDS_VECTORS = [
  {
    text: 'hello',
    cid: 'bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq',
  },
  {
    text: 'conversensus',
    cid: 'bafkreig7jg6oy63mykyfwfiumu3qwxbm3qggzffeidwl7bm2ulq6h7l2ta',
  },
] as const;

describe('computeBlobCid', () => {
  test.each(PDS_VECTORS)('PDS が返した CID と一致する ($text)', async ({
    text,
    cid,
  }) => {
    const bytes = new TextEncoder().encode(text);
    expect(await computeBlobCid(bytes)).toBe(cid);
  });

  test('同じバイト列からは必ず同じ CID が出る (content-addressed)', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    expect(await computeBlobCid(bytes)).toBe(
      await computeBlobCid(new Uint8Array([1, 2, 3, 4, 5])),
    );
  });

  test('1 バイト違えば別の CID になる', async () => {
    expect(await computeBlobCid(new Uint8Array([1, 2, 3]))).not.toBe(
      await computeBlobCid(new Uint8Array([1, 2, 4])),
    );
  });

  test('subarray (byteOffset を持つビュー) でも、その範囲だけの CID になる', async () => {
    const whole = new Uint8Array([9, 9, 1, 2, 3, 9]);
    const view = whole.subarray(2, 5);
    expect(await computeBlobCid(view)).toBe(
      await computeBlobCid(new Uint8Array([1, 2, 3])),
    );
    expect(await computeBlobCid(view)).not.toBe(await computeBlobCid(whole));
  });

  test('空のバイト列でも CID を計算できる', async () => {
    const cid = await computeBlobCid(new Uint8Array(0));
    expect(isBlobCid(cid)).toBe(true);
  });

  test('長さは常に BLOB_CID_LENGTH で、raw + sha-256 の接頭辞 bafkrei を持つ', async () => {
    for (const size of [1, 100, 10_000]) {
      const cid = await computeBlobCid(new Uint8Array(size));
      expect(cid).toHaveLength(BLOB_CID_LENGTH);
      // 'bafkrei' は CIDv1 / raw / sha-256 を base32 にしたときの固定の接頭辞
      expect(cid.startsWith('bafkrei')).toBe(true);
    }
  });
});

describe('isBlobCid', () => {
  test.each(PDS_VECTORS)('実際の CID を受け入れる ($text)', ({ cid }) => {
    expect(isBlobCid(cid)).toBe(true);
  });

  test.each([
    ['空文字', ''],
    ['multibase 接頭辞が違う', `z${PDS_VECTORS[0].cid.slice(1)}`],
    ['短い', PDS_VECTORS[0].cid.slice(0, -1)],
    ['長い', `${PDS_VECTORS[0].cid}a`],
    ['base32 に無い文字 (1)', `${PDS_VECTORS[0].cid.slice(0, -1)}1`],
    ['大文字', PDS_VECTORS[0].cid.toUpperCase()],
    ['パストラバーサル', '../../etc/passwd'],
  ])('%s は受け入れない', (_name, value) => {
    expect(isBlobCid(value)).toBe(false);
  });
});

describe('MAX_BLOB_SIZE', () => {
  test('PDS の実測値 5 MiB と一致する', () => {
    expect(MAX_BLOB_SIZE).toBe(5_242_880);
  });
});
