import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Did, NodeId, Op } from '@conversensus/shared';
import type { StoredBlob } from '../api';
import {
  collectImageBlobRefs,
  createPdsBlobUploader,
  imagePropertiesChange,
  imagePropertiesOf,
  type ResolveImageDeps,
  readImageBlobLocation,
  replaceImageProperties,
  resolveImageUrl,
  type SaveImageDeps,
  saveImageBlob,
  type UploadImageBlobDeps,
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

describe('replaceImageProperties / imagePropertiesChange', () => {
  const ref = {
    $type: 'blob' as const,
    ref: { $link: CID },
    mimeType: PNG,
    size: 3,
  };

  it('新しい blob ref を image キーに置く', () => {
    expect(replaceImageProperties(undefined, ref)).toEqual({ image: ref });
  });

  it('画像以外の properties は残す', () => {
    // `node.setProperties` は置換意味論なので、差分だけを返すと他が消える
    const existing = { imageUrl: 'https://example.com/a.png', color: 'red' };
    expect(replaceImageProperties(existing, ref)).toEqual({
      imageUrl: 'https://example.com/a.png',
      color: 'red',
      image: ref,
    });
  });

  it('古い blob ref を上書きする', () => {
    const existing = {
      image: { $type: 'blob', ref: { $link: OTHER_CID }, mimeType: PNG },
    };
    expect(
      (replaceImageProperties(existing, ref).image as typeof ref).ref.$link,
    ).toBe(CID);
  });

  it('旧形式の画像キーは落とす', () => {
    // とりわけ imageDataUrl (base64) を持ち回すと、差し替えのたびに base64 が
    // 新しい op へ載り直してレコード上限 (約 1 MB) に当たる
    const existing = {
      imageDataUrl: 'data:image/png;base64,AAAA',
      imageBlobCid: OTHER_CID,
      imageBlobMimeType: PNG,
      imageUrl: 'https://example.com/a.png',
    };
    expect(replaceImageProperties(existing, ref)).toEqual({
      imageUrl: 'https://example.com/a.png',
      image: ref,
    });
  });

  it('元の properties を書き換えない', () => {
    const existing = { imageDataUrl: 'data:image/png;base64,AAAA' };
    replaceImageProperties(existing, ref);
    expect(existing.imageDataUrl).toBe('data:image/png;base64,AAAA');
  });

  it('from は差し替え前の全体 (undo で欠けないこと)', () => {
    // invertEvent は from と to を入れ替えるだけなので、片方が差分だと
    // 元に戻したときに properties が欠ける
    const existing = { imageUrl: 'https://example.com/a.png' };
    expect(imagePropertiesChange(existing, ref)).toEqual({
      from: { imageUrl: 'https://example.com/a.png' },
      to: { imageUrl: 'https://example.com/a.png', image: ref },
    });
  });
});

describe('collectImageBlobRefs', () => {
  const ref = (cid: string) => ({
    $type: 'blob' as const,
    ref: { $link: cid },
    mimeType: PNG,
    size: 3,
  });
  const addImage = (target: string, cid: string): Op => ({
    kind: 'node.add',
    target: target as NodeId,
    content: '',
    nodeType: 'image',
    properties: imagePropertiesOf(ref(cid)),
  });

  it('properties.image の blob ref を集める', () => {
    expect(collectImageBlobRefs([addImage('n1', CID)])).toEqual([ref(CID)]);
  });

  it('同じ cid は 1 つに畳む (同じ画像を貼り直しても upload は 1 回)', () => {
    expect(
      collectImageBlobRefs([addImage('n1', CID), addImage('n2', CID)]),
    ).toEqual([ref(CID)]);
  });

  it('node.setProperties で差し替えた画像も集める (ANA-117 の経路)', () => {
    const ops: Op[] = [
      {
        kind: 'node.setProperties',
        target: 'n1' as NodeId,
        properties: imagePropertiesOf(ref(OTHER_CID)),
      },
    ];
    expect(collectImageBlobRefs(ops)).toEqual([ref(OTHER_CID)]);
  });

  it('properties を持たない op と画像でない properties は無視する', () => {
    const ops: Op[] = [
      { kind: 'node.remove', target: 'n1' as NodeId },
      { kind: 'node.setLayout', target: 'n1' as NodeId, x: 1, y: 2 },
      {
        kind: 'node.add',
        target: 'n2' as NodeId,
        content: 'text',
        properties: { color: 'red' },
      },
    ];
    expect(collectImageBlobRefs(ops)).toEqual([]);
  });

  it('旧 flat 形式 (imageBlobCid) は集めない', () => {
    // PDS から見ればただの文字列で pin の対象にならないので、先に上げる意味が無い。
    // 旧経路は作成時に upload 済でもある
    const ops: Op[] = [
      {
        kind: 'node.add',
        target: 'n1' as NodeId,
        content: '',
        properties: { imageBlobCid: CID, imageBlobMimeType: PNG },
      },
    ];
    expect(collectImageBlobRefs(ops)).toEqual([]);
  });
});

describe('createPdsBlobUploader', () => {
  const imageOp = (cid: string): Op => ({
    kind: 'node.add',
    target: 'n1' as NodeId,
    content: '',
    nodeType: 'image',
    properties: imagePropertiesOf({
      $type: 'blob',
      ref: { $link: cid },
      mimeType: PNG,
      size: 3,
    }),
  });

  function uploadDeps(overrides: Partial<UploadImageBlobDeps> = {}) {
    const local = mock(
      async (_cid: string) =>
        new Blob([bytesOf(1, 2, 3)], { type: PNG }) as Blob | undefined,
    );
    const upload = mock(async (_bytes: Uint8Array, _mime: string) => ({
      cid: CID,
      mimeType: PNG,
      size: 3,
    }));
    return {
      deps: { local, upload, ...overrides } as UploadImageBlobDeps,
      local,
      upload,
    };
  }

  it('ローカルの実体を PDS へ上げる', async () => {
    const { deps, local, upload } = uploadDeps();
    await createPdsBlobUploader(deps)([imageOp(CID)]);

    expect(local).toHaveBeenCalledWith(CID);
    expect(Array.from(upload.mock.calls[0][0] as Uint8Array)).toEqual([
      1, 2, 3,
    ]);
    expect(upload.mock.calls[0][1]).toBe(PNG);
  });

  it('同じ cid は 2 回目以降上げない (セッション内で覚える)', async () => {
    // flush のたびに同じ画像を上げ直すと、再送のたびに実体を往復させることになる
    const { deps, upload } = uploadDeps();
    const uploader = createPdsBlobUploader(deps);
    await uploader([imageOp(CID)]);
    await uploader([imageOp(CID)]);

    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('画像を含まない op では PDS を触らない', async () => {
    const { deps, local, upload } = uploadDeps();
    await createPdsBlobUploader(deps)([
      { kind: 'node.remove', target: 'n1' as NodeId },
    ]);

    expect(local).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('ローカルに実体が無ければ飛ばす (投げない)', async () => {
    // この端末では上げようがない。レコード側は PDS に既にあれば通り、無ければ
    // push が失敗して未同期のまま残る — ここで投げると後者を先取りしてしまう
    const { deps, upload } = uploadDeps({ local: async () => undefined });
    await createPdsBlobUploader(deps)([imageOp(CID)]);

    expect(upload).not.toHaveBeenCalled();
  });

  it('PDS が別の cid を返したら投げる', async () => {
    // CID はバイト列から決まる (S1 U2) ので、食い違いは別の実体を上げたことを意味する。
    // そのまま進むと参照先が pin されないレコードができる
    const { deps } = uploadDeps({
      upload: async () => ({ cid: OTHER_CID, mimeType: PNG, size: 3 }),
    });

    await expect(createPdsBlobUploader(deps)([imageOp(CID)])).rejects.toThrow(
      /CID mismatch/,
    );
  });

  it('食い違いで投げた cid は上げ済みにしない (再送で上げ直す)', async () => {
    let returned = OTHER_CID;
    const upload = mock(async (_bytes: Uint8Array, _mime: string) => ({
      cid: returned,
      mimeType: PNG,
      size: 3,
    }));
    const { deps } = uploadDeps({ upload });
    const uploader = createPdsBlobUploader(deps);

    await expect(uploader([imageOp(CID)])).rejects.toThrow(/CID mismatch/);
    returned = CID;
    await uploader([imageOp(CID)]);

    expect(upload).toHaveBeenCalledTimes(2);
  });
});
