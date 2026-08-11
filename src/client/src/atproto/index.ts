export {
  AtprotoSyncProvider,
  type AtprotoSyncProviderDeps,
  type BatchCollection,
} from './atprotoSyncProvider';
export {
  batchToRecord,
  isBatchRecordValue,
  recordToBatch,
} from './batchMapper';
export {
  cacheBlobUrl,
  fetchRemoteBlob,
  getCachedBlobUrl,
  loggedInDid,
  uploadImageBlob,
} from './blob';
export type { AtprotoSession } from './client';
export { currentDid, getAgent, login, logout, resumeSession } from './client';
// step1 Phase 6 p6-5b: PDS legacy レコード (file/sheet/node/edge/layout/branch/
// commit/merge) を読み書きする経路は退役した。ここに残るのは op-log の batch
// コレクションと、legacy file レコードの後始末に使う `files` だけ (設計 §3.8)。
export { batches, files, TRUNK_PREFIX } from './collections';
export type { BatchRecord, RecordResult, StrongRef } from './types';
export { NSID } from './types';
