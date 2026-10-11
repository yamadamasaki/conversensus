import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  BLOB_CID_LENGTH,
  computeBlobCid,
  isBlobCid,
  MAX_BLOB_SIZE,
  repairBrokenBlobRefs,
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
  // test.each ではなくループで回す — bun の test.each はオブジェクトの表を
  // unknown[] としてしか受け取らないので, 分解した text / cid の型が落ちる
  for (const { text, cid } of PDS_VECTORS) {
    test(`PDS が返した CID と一致する (${text})`, async () => {
      const bytes = new TextEncoder().encode(text);
      expect(await computeBlobCid(bytes)).toBe(cid);
    });
  }

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
  for (const { text, cid } of PDS_VECTORS) {
    test(`実際の CID を受け入れる (${text})`, () => {
      expect(isBlobCid(cid)).toBe(true);
    });
  }

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

/** CIDv1 / raw / sha-256 のバイト列 (computeBlobCid と同じ組み立て) */
async function cidBytesOf(data: Uint8Array): Promise<Uint8Array> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer),
  );
  return new Uint8Array([0x01, 0x55, 0x12, 0x20, ...digest]);
}

/** JSON に書かれた Uint8Array の形 (数字の鍵を持つ object) */
const asStoredBytes = (bytes: Uint8Array) =>
  Object.fromEntries([...bytes].map((b, i) => [String(i), b]));

/**
 * 壊れて保存された参照 (#264): BlobRef のインスタンスを structured clone して JSON にしたもの。
 * 実物の形は client の `blobRefRepair.test.ts` が @atproto/api から作って確かめている
 */
function brokenRef(cidBytes: Uint8Array, mimeType = 'image/png', size = 3) {
  const ref = {
    code: 0x55,
    version: 1,
    multihash: {
      code: 0x12,
      size: 32,
      digest: asStoredBytes(cidBytes.slice(4)),
      bytes: asStoredBytes(cidBytes.slice(2)),
    },
    bytes: asStoredBytes(cidBytes),
  };
  return {
    ref,
    mimeType,
    size,
    original: { $type: 'blob', ref, mimeType, size },
  };
}

describe('repairBrokenBlobRefs (#264)', () => {
  test('壊れた参照を、保存されている CID のバイト列から元の形に戻す', async () => {
    const data = new Uint8Array([1, 2, 3]);
    const repaired = repairBrokenBlobRefs({
      image: brokenRef(await cidBytesOf(data)),
    });
    expect(repaired).toEqual({
      image: {
        $type: 'blob',
        ref: { $link: await computeBlobCid(data) },
        mimeType: 'image/png',
        size: 3,
      },
    });
  });

  test('op の配列の奥にあっても直し、ほかの値は変えない', async () => {
    const cid = await cidBytesOf(new Uint8Array([9]));
    const ops = [
      { kind: 'node.add', target: 'n1', content: 'x' },
      {
        kind: 'node.setProperty',
        target: 'n2',
        name: 'image',
        value: brokenRef(cid),
      },
    ];
    const repaired = repairBrokenBlobRefs(ops) as typeof ops;
    expect(repaired[0]).toBe(ops[0]);
    const second = repaired[1] as unknown as { value: { $type: string } };
    expect(second.value.$type).toBe('blob');
  });

  test('∀ 壊れていない値. 何もせず同じ値を返す (書き直しの要否を === で判定できる)', () => {
    const healthy = {
      $type: 'blob',
      ref: { $link: 'bafkreiabc' },
      mimeType: 'image/png',
      size: 1,
    };
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        const value = { v, healthy };
        return repairBrokenBlobRefs(value) === value;
      }),
    );
  });

  test('バイト列が読めない形なら直さない (別のものを壊さない)', () => {
    const odd = {
      ref: { version: 1, multihash: {}, bytes: { a: 1 } },
      mimeType: 'image/png',
    };
    expect(repairBrokenBlobRefs(odd)).toBe(odd);
  });
});
