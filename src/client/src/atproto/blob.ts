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
  const raw = res.data as unknown as Record<string, unknown>;
  console.log('[blob] raw keys:', Object.keys(raw));
  const blob = raw.blob as Record<string, unknown>;
  console.log('[blob] blob keys:', Object.keys(blob));
  console.log('[blob] blob.ref:', blob.ref);
  console.log('[blob] blob.ref type:', typeof blob.ref);
  if (blob.ref && typeof blob.ref === 'object') {
    const ref = blob.ref as Record<string, unknown>;
    console.log('[blob] ref keys:', Object.keys(ref));
    console.log('[blob] ref.$link:', ref.$link);
    console.log('[blob] ref["$link"]:', ref.$link);
  }
  if (!res.success) {
    throw new Error('Blob upload failed');
  }
  const cid =
    ((blob.ref as Record<string, unknown> | undefined)?.$link as string) ??
    (blob.cid as string);
  return {
    cid,
    mimeType: blob.mimeType as string,
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
