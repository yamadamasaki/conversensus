import type { Did } from '@conversensus/shared';
import { currentDid, getAgent } from './client';

type ImageBlobRef = {
  cid: string;
  mimeType: string;
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
  };
}

// アップロード直後の画像をキャッシュし、getBlob せずに即時表示できるようにする
const imageCache = new Map<string, string>();

export function cacheBlobUrl(cid: string, bytes: Uint8Array, mimeType: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  imageCache.set(cid, url);
}

export function getCachedBlobUrl(cid: string): string | undefined {
  return imageCache.get(cid);
}

export async function resolveBlobUrl(
  did: Did,
  cid: string,
  mimeType: string,
): Promise<string> {
  const res = await getAgent().api.com.atproto.sync.getBlob({ did, cid });
  if (!res.success) {
    throw new Error(`Failed to resolve blob: ${cid}`);
  }
  const blob = new Blob([res.data], { type: mimeType });
  return URL.createObjectURL(blob);
}

let _uploadEnabled: boolean | null = null;

export function isBlobUploadEnabled(): boolean {
  if (_uploadEnabled !== null) return _uploadEnabled;
  try {
    currentDid();
    _uploadEnabled = true;
  } catch {
    _uploadEnabled = false;
  }
  return _uploadEnabled;
}
