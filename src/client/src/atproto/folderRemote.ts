/**
 * Folder と File の置き場の保存先 = 自分の PDS (step3 Phase 6 S6-2b)
 *
 * 書き込みは outbox を通さない。項目ごとの最新値を送るだけなので、送れなかったものは
 * 写し (`FolderReplica`) が未送信として持ち続け、次の機会に送り直す。
 */

import type { FolderRemote } from '../folders/folderReplica';
import type { FilePlacement, Folder } from '../folders/types';
import { rkeyFromUri } from './batchRkey';
import { filePlacements, folders } from './collections';
import {
  filePlacementToRecord,
  folderToRecord,
  recordToFilePlacement,
  recordToFolder,
} from './folderMapper';
import type { RecordSummary } from './rangeFetch';

/** レコードを読み、壊れたものは数えて警告する (他の端末が書いたものを読むので) */
function decode<T>(
  records: RecordSummary[],
  read: (rkey: string, value: unknown) => T | null,
  what: string,
): T[] {
  const found: T[] = [];
  for (const record of records) {
    const item = read(rkeyFromUri(record.uri), record.value);
    if (item !== null) found.push(item);
  }
  if (found.length < records.length) {
    console.warn(
      `[folders] skipped ${records.length - found.length} malformed ${what} record(s)`,
    );
  }
  return found;
}

export const pdsFolderRemote: FolderRemote = {
  async listFolders(): Promise<Folder[]> {
    return decode(await folders.list(), recordToFolder, 'folder');
  },
  async listPlacements(): Promise<FilePlacement[]> {
    return decode(
      await filePlacements.list(),
      recordToFilePlacement,
      'file placement',
    );
  },
  async putFolder(folder) {
    await folders.put(folder.id, folderToRecord(folder));
  },
  async deleteFolder(id) {
    await folders.delete(id);
  },
  async putPlacement(placement) {
    await filePlacements.put(
      placement.fileId,
      filePlacementToRecord(placement),
    );
  },
  async deletePlacement(fileId) {
    await filePlacements.delete(fileId);
  },
};
