/**
 * ローカル正典への入口 (step1 以来の `api.ts`)
 *
 * hooks から上はこの 9 関数だけを見る。中身は差し替えられるバックエンド (`local/backend.ts`)
 * に委ねる (step3 Phase 2 D2) — 既定はローカルサーバの HTTP、App 結合テストは同じプロセスの
 * `LocalStore`、S2-3 からはブラウザ内の Worker である。
 */

import type { BlobCid, MimeType } from '@conversensus/shared';
import type { LocalBackend } from './local/backend';
import { httpBackend } from './local/httpBackend';

export type { StoredBlob } from '@conversensus/shared';

let backend: LocalBackend = httpBackend;

/** バックエンドを差し替える。App 結合テスト (端末ごとの DB) と、起動時の選択が呼ぶ */
export function setLocalBackend(next: LocalBackend): void {
  backend = next;
}

export const fetchFiles: LocalBackend['fetchFiles'] = () =>
  backend.fetchFiles();
export const fetchLocalFileIds: LocalBackend['fetchLocalFileIds'] = () =>
  backend.fetchLocalFileIds();
export const createFile: LocalBackend['createFile'] = (name) =>
  backend.createFile(name);
export const postImportFile: LocalBackend['postImportFile'] = (data) =>
  backend.postImportFile(data);
export const pushBatches: LocalBackend['pushBatches'] = (fileId, batches) =>
  backend.pushBatches(fileId, batches);
export const pushReceivedBatches: LocalBackend['pushReceivedBatches'] = (
  fileId,
  batches,
) => backend.pushReceivedBatches(fileId, batches);
export const fetchBatches: LocalBackend['fetchBatches'] = (fileId, since) =>
  backend.fetchBatches(fileId, since);
export const putBlob = (bytes: Uint8Array, mimeType: MimeType) =>
  backend.putBlob(bytes, mimeType);
export const fetchBlob = (cid: BlobCid) => backend.fetchBlob(cid);
