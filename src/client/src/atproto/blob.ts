import type { Did } from '@conversensus/shared';
import { currentDid, getAgent } from './client';

type ImageBlobRef = {
  cid: string;
  mimeType: string;
  size: number;
};

export async function uploadImageBlob(
  bytes: Uint8Array,
  mimeType: string,
): Promise<ImageBlobRef> {
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

// アップロード直後の画像をキャッシュし、getBlob せずに即時表示できるようにする
const imageCache = new Map<string, string>();

export function cacheBlobUrl(cid: string, bytes: Uint8Array, mimeType: string) {
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
