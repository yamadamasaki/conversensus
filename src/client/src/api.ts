/**
 * ローカル正典への入口 (step1 以来の `api.ts`)
 *
 * hooks から上はこの 9 関数だけを見る。中身は差し替えられるバックエンド (`local/backend.ts`)
 * に委ねる (step3 Phase 2 D2) — ブラウザでは Worker の中の `LocalStore`、App 結合テストは同じ
 * プロセスの `LocalStore` である。
 */

import type { BlobCid, MimeType } from '@conversensus/shared';
import type { LocalBackend } from './local/backend';

export type { StoredBlob } from '@conversensus/shared';

/**
 * まだ選ばれていないときのバックエンド。**呼ばれたら落とす** — 黙って何も保存しないと、
 * 編集が消えたことに気づけない。起動 (`main.tsx`) が Worker のバックエンドを選ぶ
 */
const UNCONFIGURED: LocalBackend = new Proxy({} as LocalBackend, {
  get: (_target, method) => () =>
    Promise.reject(
      new Error(`ローカル正典が開かれていない (${String(method)})`),
    ),
});

let backend: LocalBackend = UNCONFIGURED;

/**
 * バックエンドを選ぶ。起動 (`main.tsx`, Worker) と App 結合テスト (端末ごとの DB) が呼ぶ。
 * null で選んでいない状態に戻す
 */
export function setLocalBackend(next: LocalBackend | null): void {
  backend = next ?? UNCONFIGURED;
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
