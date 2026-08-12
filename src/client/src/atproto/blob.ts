import type { Did } from '@conversensus/shared';
import { currentDid, getAgent } from './client';

/**
 * `uploadBlob` の戻り値を畳んだ形。**op に載せる blob ref とは別物である** —
 * あちらは `{$type:'blob', ref:{$link}, …}` で, 名前を揃えると取り違える。
 *
 * とりわけ `{cid, mimeType}` の 2 キーの形は `@atproto/lexicon` の `ipldToLex` が
 * blob ref と誤認するので, **この形を op の properties へ置いてはならない**
 * (`images/imageBlob.ts` の `ImageBlobRef` を使う)。
 */
type UploadedBlob = {
  cid: string;
  mimeType: string;
  size: number;
};

export async function uploadImageBlob(
  bytes: Uint8Array,
  mimeType: string,
): Promise<UploadedBlob> {
  const res = await getAgent().api.com.atproto.repo.uploadBlob(bytes, {
    encoding: mimeType,
  });
  if (!res.success) {
    throw new Error('Blob upload failed');
  }
  const blob = res.data.blob;
  // ref は multiformats CID オブジェクト。toString() で文字列表現を取得する
  const cid = (blob.ref as { toString?: () => string }).toString?.() ?? '';
  return {
    cid,
    mimeType: blob.mimeType,
    size: blob.size as number,
  };
}

/**
 * 保存直後の画像を即時表示するためのキャッシュ (cid → Object URL)。
 *
 * **セッション中は捨てない。** content-addressed なので中身が古くなることは無く、
 * 表示中のノードがどれかをここでは知りようがないため (共有キャッシュの URL を
 * revoke すると、それを使っている別のノードの画像が壊れる)。
 * 上限を設けるなら「表示中の参照数」を持つ必要があり、それは別の設計になる。
 */
const imageCache = new Map<string, string>();

export function cacheBlobUrl(cid: string, bytes: Uint8Array, mimeType: string) {
  // **既にあるなら作り直さない。** cid が同じなら中身も同じなので新しい URL に
  // する意味が無く、作り直すと古い方が孤児になる (差し替えが日常操作になった
  // ANA-117 以降、画像を受け入れるたびに 1 つずつ増えていた)。
  // ここで古い方を revoke するのも誤り — 表示中の別ノードがその URL を使っている
  if (imageCache.has(cid)) return;
  // bytes のコピーを作成（元の ArrayBuffer が uploadBlob で消費される可能性があるため）
  const copy = bytes.slice();
  const url = URL.createObjectURL(new Blob([copy], { type: mimeType }));
  imageCache.set(cid, url);
}

export function getCachedBlobUrl(cid: string): string | undefined {
  return imageCache.get(cid);
}

/**
 * PDS から blob の実体を取る (ANA-116 S3)。
 *
 * **URL ではなく `Blob` を返す。** 呼び出し元 (`images/imageBlob.ts`) が中身を
 * ローカル blob ストアへ書き戻せるようにするためである — URL だけ渡されると
 * 書き戻しのために取り直す羽目になる。
 */
export async function fetchRemoteBlob(
  did: Did,
  cid: string,
  mimeType: string,
): Promise<Blob> {
  // com.atproto.sync.getBlob を試す
  try {
    const res = await getAgent().api.com.atproto.sync.getBlob({ did, cid });
    if (res.success) {
      return new Blob([res.data], { type: mimeType });
    }
    console.warn('[blob] sync.getBlob returned success=false');
  } catch (err) {
    console.warn('[blob] sync.getBlob failed:', err);
  }

  // フォールバック: PDS の raw blob URL
  const pdsUrl = getAgent().service.toString();
  const rawUrl = `${pdsUrl}/blob/${did}/${cid}`;
  const res = await fetch(rawUrl);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Failed to resolve blob ${cid} (HTTP ${res.status}): ${body}`,
    );
  }
  return new Blob([await res.arrayBuffer()], { type: mimeType });
}

/**
 * ログイン中なら DID を、未ログインなら `undefined` を返す。
 *
 * **記憶してはならない** — ログイン状態は実行中に変わる。ANA-116 で撤去した
 * `isBlobUploadEnabled` は初回の結果をキャッシュしており、未ログインで起動した
 * セッションではログイン後も false のままだった。
 */
export function loggedInDid(): Did | undefined {
  try {
    return currentDid();
  } catch {
    return undefined;
  }
}
