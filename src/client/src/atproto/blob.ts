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
  console.log('[blob] uploadBlob response:', JSON.stringify(res.data, null, 2));
  if (!res.success) {
    throw new Error('Blob upload failed');
  }
  const blob = res.data.blob;
  const cid =
    blob.ref?.$link ??
    ((blob as unknown as Record<string, unknown>).cid as string);
  return {
    cid,
    mimeType: blob.mimeType,
  };
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
