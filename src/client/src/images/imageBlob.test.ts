import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Did } from '@conversensus/shared';
import type { StoredBlob } from '../api';
import {
  imagePropertiesOf,
  type ResolveImageDeps,
  readImageBlobLocation,
  resolveImageUrl,
  type SaveImageDeps,
  saveImageBlob,
} from './imageBlob';

// 実在の CID ベクタ。CID の長さや文字種を暗黙に前提にする実装を落とせるよう、
// それらしい文字列ではなく本物を使う (`hello` と `[1,2,3]` の CID)
const CID = 'bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq';
const OTHER_CID = 'bafkreiadsbmmn4waznesyuz3bjgrj33xzqhxrk6mz3ksq7meugrachh3qe';
const PNG = 'image/png';
const DID = 'did:plc:testtesttesttesttest' as Did;
const MAX_BLOB_SIZE = 5 * 1024 * 1024;

// Object URL は自前のスタブに差し替える。テスト環境の実装差に左右されず、
// 「blob: の URL を返したかどうか」だけを見られるようにするため
let urlSeq = 0;

beforeEach(() => {
  urlSeq = 0;
  URL.createObjectURL = () => {
    urlSeq += 1;
    return `blob:stub/${urlSeq}`;
  };
});

function bytesOf(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

/** `Blob` の最小スタブ。bun のテスト環境の実装差に依存しないようにする */
function fakeSource(
  bytes: Uint8Array,
  type: string,
  size = bytes.length,
): Blob {
  return {
    type,
    size,
    arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer,
  } as unknown as Blob;
}

function stored(cid = CID, mimeType = PNG, size = 3): StoredBlob {
  return { cid, mimeType, size };
}

function saveDeps(overrides: Partial<SaveImageDeps> = {}): {
  deps: SaveImageDeps;
  put: ReturnType<typeof mock>;
  cache: ReturnType<typeof mock>;
} {
  const put = mock(async (_bytes: Uint8Array, _mime: string) => stored());
  const cache = mock(
    (_cid: string, _bytes: Uint8Array, _mime: string) => undefined,
  );
  return {
    deps: { put, cache, ...overrides } as SaveImageDeps,
    put,
    cache,
  };
}

function resolveDeps(overrides: Partial<ResolveImageDeps> = {}) {
  const deps: ResolveImageDeps = {
    cached: () => undefined,
    local: async () => undefined,
    remote: async () => new Blob([bytesOf(1)], { type: PNG }),
    put: async () => stored(),
    did: () => undefined,
    ...overrides,
  } as ResolveImageDeps;
  return deps;
}

describe('readImageBlobLocation', () => {
  it('新形式の blob ref から cid と mimeType を読む', () => {
    const props = {
      image: { $type: 'blob', ref: { $link: CID }, mimeType: PNG, size: 3 },
    };
    expect(readImageBlobLocation(props)).toEqual({ cid: CID, mimeType: PNG });
  });

  it('size が無くても読める (読み取りは書き込みより緩い)', () => {
    const props = {
      image: { $type: 'blob', ref: { $link: CID }, mimeType: PNG },
    };
    expect(readImageBlobLocation(props)).toEqual({ cid: CID, mimeType: PNG });
  });

  it('旧形式の flat なキーを読む', () => {
    const props = { imageBlobCid: CID, imageBlobMimeType: PNG };
    expect(readImageBlobLocation(props)).toEqual({ cid: CID, mimeType: PNG });
  });

  it('新形式があれば旧形式より優先する', () => {
    const props = {
      image: { $type: 'blob', ref: { $link: CID }, mimeType: PNG, size: 3 },
      imageBlobCid: OTHER_CID,
      imageBlobMimeType: 'image/jpeg',
    };
    expect(readImageBlobLocation(props)).toEqual({ cid: CID, mimeType: PNG });
  });

  it('properties が無い / 画像が無いときは undefined', () => {
    expect(readImageBlobLocation(undefined)).toBeUndefined();
    expect(readImageBlobLocation({})).toBeUndefined();
    expect(
      readImageBlobLocation({ imageUrl: 'https://example.com/a.png' }),
    ).toBeUndefined();
  });

  it('$type が blob でないオブジェクトは blob ref として読まない', () => {
    const props = { image: { ref: { $link: CID }, mimeType: PNG } };
    expect(readImageBlobLocation(props)).toBeUndefined();
  });

  it('$link が空文字なら読まない', () => {
    const props = {
      image: { $type: 'blob', ref: { $link: '' }, mimeType: PNG },
    };
    expect(readImageBlobLocation(props)).toBeUndefined();
  });

  it('旧形式は cid と mimeType が揃っていなければ読まない', () => {
    expect(readImageBlobLocation({ imageBlobCid: CID })).toBeUndefined();
    expect(readImageBlobLocation({ imageBlobMimeType: PNG })).toBeUndefined();
  });
});

describe('saveImageBlob', () => {
  it('ローカルへ保存し ATProto の blob ref を返す', async () => {
    const { deps, put } = saveDeps();
    const ref = await saveImageBlob(fakeSource(bytesOf(1, 2, 3), PNG), deps);

    expect(ref).toEqual({
      $type: 'blob',
      ref: { $link: CID },
      mimeType: PNG,
      size: 3,
    });
    expect(put).toHaveBeenCalledTimes(1);
    const [sentBytes, sentMime] = put.mock.calls[0];
    expect(Array.from(sentBytes as Uint8Array)).toEqual([1, 2, 3]);
    expect(sentMime).toBe(PNG);
  });

  it('保存直後に表示できるようキャッシュへ入れる', async () => {
    const { deps, cache } = saveDeps();
    await saveImageBlob(fakeSource(bytesOf(1, 2, 3), PNG), deps);

    expect(cache).toHaveBeenCalledTimes(1);
    const [cid, , mime] = cache.mock.calls[0];
    expect(cid).toBe(CID);
    expect(mime).toBe(PNG);
  });

  it('上限を超える画像は保存せずに弾く', async () => {
    const { deps, put } = saveDeps();
    const oversized = fakeSource(bytesOf(1), PNG, MAX_BLOB_SIZE + 1);

    await expect(saveImageBlob(oversized, deps)).rejects.toThrow(
      /大きすぎます/,
    );
    expect(put).not.toHaveBeenCalled();
  });

  it('上限ぎりぎりでも大きさが同じ値に見えない', async () => {
    const { deps } = saveDeps();
    // 1 バイト超過は MiB に丸めると上限と同じ 5.0 MiB になる。バイト数の併記が
    // 無いと「5.0 MiB、上限は 5.0 MiB です」となって理由が伝わらない (実機で確認)
    const justOver = fakeSource(bytesOf(1), PNG, MAX_BLOB_SIZE + 1);

    await expect(saveImageBlob(justOver, deps)).rejects.toThrow(/5,242,881/);
    await expect(saveImageBlob(justOver, deps)).rejects.toThrow(/5,242,880/);
  });

  it('上限ちょうどは通す (PDS の実測値と揃える)', async () => {
    const { deps, put } = saveDeps();
    const atLimit = fakeSource(bytesOf(1), PNG, MAX_BLOB_SIZE);

    await saveImageBlob(atLimit, deps);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('画像でないものは弾く', async () => {
    const { deps, put } = saveDeps();
    const text = fakeSource(bytesOf(1), 'text/plain');

    await expect(saveImageBlob(text, deps)).rejects.toThrow(/画像ではない/);
    expect(put).not.toHaveBeenCalled();
  });

  it('保存の失敗はそのまま伝える (握り潰さない)', async () => {
    const put = mock(async () => {
      throw new Error('Failed to store blob (HTTP 413): too large');
    });
    const { deps } = saveDeps({ put: put as unknown as SaveImageDeps['put'] });

    await expect(
      saveImageBlob(fakeSource(bytesOf(1), PNG), deps),
    ).rejects.toThrow(/HTTP 413/);
  });

  it('properties の形は image キーの下に blob ref を置く', () => {
    const ref = {
      $type: 'blob' as const,
      ref: { $link: CID },
      mimeType: PNG,
      size: 3,
    };
    expect(imagePropertiesOf(ref)).toEqual({ image: ref });
  });
});

describe('resolveImageUrl', () => {
  const location = { cid: CID, mimeType: PNG };

  it('1. キャッシュがあればそれを返し、他は触らない', async () => {
    const local = mock(async () => undefined);
    const remote = mock(async () => new Blob([]));
    const deps = resolveDeps({
      cached: () => 'blob:cached',
      local: local as unknown as ResolveImageDeps['local'],
      remote: remote as unknown as ResolveImageDeps['remote'],
    });

    expect(await resolveImageUrl(location, deps)).toEqual({
      url: 'blob:cached',
      fromCache: true,
    });
    expect(local).not.toHaveBeenCalled();
    expect(remote).not.toHaveBeenCalled();
  });

  it('2. ローカル blob ストアで取れれば PDS を触らない', async () => {
    const remote = mock(async () => new Blob([]));
    const deps = resolveDeps({
      local: async () => new Blob([bytesOf(1, 2, 3)], { type: PNG }),
      remote: remote as unknown as ResolveImageDeps['remote'],
      // 未ログインでないことを確かめるため DID を与えておく
      did: () => DID,
    });

    const resolved = await resolveImageUrl(location, deps);
    expect(resolved?.fromCache).toBe(false);
    expect(resolved?.url).toStartWith('blob:');
    expect(remote).not.toHaveBeenCalled();
  });

  it('3. 未ログインならローカルに無い時点で諦める (throw しない)', async () => {
    const remote = mock(async () => new Blob([]));
    const deps = resolveDeps({
      remote: remote as unknown as ResolveImageDeps['remote'],
      did: () => undefined,
    });

    expect(await resolveImageUrl(location, deps)).toBeUndefined();
    expect(remote).not.toHaveBeenCalled();
  });

  it('3. ログイン中でローカルに無ければ PDS から取る', async () => {
    const remote = mock(async () => new Blob([bytesOf(9)], { type: PNG }));
    const deps = resolveDeps({
      remote: remote as unknown as ResolveImageDeps['remote'],
      did: () => DID,
    });

    const resolved = await resolveImageUrl(location, deps);
    expect(resolved?.url).toStartWith('blob:');
    expect(remote).toHaveBeenCalledTimes(1);
    expect(remote.mock.calls[0]).toEqual([DID, CID, PNG]);
  });

  it('PDS から取れた実体はローカルへ書き戻す', async () => {
    const put = mock(async (_bytes: Uint8Array, _mime: string) => stored());
    const deps = resolveDeps({
      remote: async () => new Blob([bytesOf(7, 8)], { type: PNG }),
      put: put as unknown as ResolveImageDeps['put'],
      did: () => DID,
    });

    await resolveImageUrl(location, deps);
    // 書き戻しは表示を待たせない (await しない) ので、解決してから確かめる
    await Promise.resolve();
    await Promise.resolve();

    expect(put).toHaveBeenCalledTimes(1);
    expect(Array.from(put.mock.calls[0][0] as Uint8Array)).toEqual([7, 8]);
  });

  it('書き戻しに失敗しても表示は妨げない', async () => {
    const deps = resolveDeps({
      remote: async () => new Blob([bytesOf(7)], { type: PNG }),
      put: (async () => {
        throw new Error('daemon down');
      }) as unknown as ResolveImageDeps['put'],
      did: () => DID,
    });

    const resolved = await resolveImageUrl(location, deps);
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved?.url).toStartWith('blob:');
  });

  it('PDS の取得自体が失敗したときは投げる (呼び出し元がログに出す)', async () => {
    const deps = resolveDeps({
      remote: (async () => {
        throw new Error('Failed to resolve blob (HTTP 404): ');
      }) as unknown as ResolveImageDeps['remote'],
      did: () => DID,
    });

    await expect(resolveImageUrl(location, deps)).rejects.toThrow(/HTTP 404/);
  });
});
