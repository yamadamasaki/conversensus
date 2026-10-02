/**
 * アドレスが指すシートを手元の正典から求める (step3 Phase 3 S3-5)
 *
 * 見るだけの pane (multiple モード) の中身はこれで求める。アクティブな pane は File・branch の
 * 画面の仕組み (`useFileSheetOperations` / `useBranchOperations`) が持つが、見るだけの pane は
 * その外にあり、**アドレスだけから**中身を決める (設計 F3: view ごとにアドレスから projection する)。
 *
 * branch のアドレスは id しか持たないので、branch のメタ (分岐点・branch 専用の op-log) を trunk の
 * 畳み込みで解決してから `projectAddress` に渡す
 */

import {
  type Batch,
  type FileId,
  type GraphViewAddress,
  projectAddress,
  type Sheet,
} from '@conversensus/shared';
import { readBranchMeta } from './branchMetaLog';

/** 求めた結果。シートか branch が (その切断面で) 無ければ `missing` */
export type AddressSheet =
  | { kind: 'sheet'; sheet: Sheet; fileIds: readonly FileId[] }
  | { kind: 'missing'; fileIds: readonly FileId[] };

/**
 * @returns シートと、**読んだ op-log の File** (`fileIds`)。読み直しの契機 (正典が動いた知らせ) を
 *   これで絞る — branch のアドレスは trunk と branch 専用の op-log の両方に依る
 */
export async function loadAddressSheet(
  address: GraphViewAddress,
  fetchBatches: (fileId: FileId) => Promise<Batch[]>,
): Promise<AddressSheet> {
  const trunk = await fetchBatches(address.fileId);
  if (address.branchId === null) {
    const sheet = projectAddress(address, { trunk });
    return sheet
      ? { kind: 'sheet', sheet, fileIds: [address.fileId] }
      : { kind: 'missing', fileIds: [address.fileId] };
  }
  const { branches } = await readBranchMeta(
    async (id) => (id === address.fileId ? trunk : fetchBatches(id)),
    address.fileId,
  );
  const branch = branches.get(address.branchId);
  if (!branch) return { kind: 'missing', fileIds: [address.fileId] };
  const fileIds = [address.fileId, branch.branchFileId];
  const sheet = projectAddress(address, {
    trunk,
    branch: { branch, batches: await fetchBatches(branch.branchFileId) },
  });
  return sheet
    ? { kind: 'sheet', sheet, fileIds }
    : { kind: 'missing', fileIds };
}
