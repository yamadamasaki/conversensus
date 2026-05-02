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

export function createImageDataUrl(
  bytes: Uint8Array,
  mimeType: string,
): string {
  const copy = bytes.slice();
  const base64 = btoa(
    Array.from(copy)
      .map((b) => String.fromCharCode(b))
      .join(''),
  );
  return `data:${mimeType};base64,${base64}`;
}

export function getCachedBlobUrl(cid: string): string | undefined {
  return imageCache.get(cid);
}

export async function resolveBlobUrl(
  did: Did,
  cid: string,
  mimeType: string,
): Promise<string> {
  // com.atproto.sync.getBlob を試す
  try {
    const res = await getAgent().api.com.atproto.sync.getBlob({ did, cid });
    if (res.success) {
      const blob = new Blob([res.data], { type: mimeType });
      return URL.createObjectURL(blob);
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
  const data = await res.arrayBuffer();
  const blob = new Blob([data], { type: mimeType });
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
