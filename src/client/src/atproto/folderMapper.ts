/**
 * Folder・File の置き場 ↔ PDS レコード (step3 Phase 6 S6-0)
 *
 * **id は rkey が持ち、本文には持たない。**項目ごとの後勝ちは rkey の単位で起きるので、
 * 同一性の権威を rkey の 1 箇所に置く (本文にも持つと、食い違ったときにどちらが正か
 * という問いが生まれる)。
 *
 * 他の端末が書いたレコードを読むので境界で検証する。壊れたものは `null`。
 */

import { FileIdSchema, FolderIdSchema } from '@conversensus/shared';
import { z } from 'zod';
import type { FilePlacement, Folder } from '../folders/types';
import type { FilePlacementRecord, FolderRecord } from './types';

const FolderBodySchema = z.object({
  name: z.string().min(1),
  parent: FolderIdSchema.optional(),
  createdAt: z.string().datetime(),
});

const FilePlacementBodySchema = z.object({
  folder: FolderIdSchema,
});

/** rkey (= FolderId) は呼び出し側が `folder.id` から付ける */
export function folderToRecord(folder: Folder): Omit<FolderRecord, '$type'> {
  return {
    name: folder.name,
    // 値が undefined のキーを PDS へ送らない (トップ・レベルは「parent が無い」で表す)
    ...(folder.parent === undefined ? {} : { parent: folder.parent }),
    createdAt: folder.createdAt,
  };
}

export function recordToFolder(rkey: string, value: unknown): Folder | null {
  const id = FolderIdSchema.safeParse(rkey);
  const body = FolderBodySchema.safeParse(value);
  if (!id.success || !body.success) return null;
  return { id: id.data, ...body.data };
}

/** rkey (= FileId) は呼び出し側が `placement.fileId` から付ける */
export function filePlacementToRecord(
  placement: FilePlacement,
): Omit<FilePlacementRecord, '$type'> {
  return { folder: placement.folder };
}

export function recordToFilePlacement(
  rkey: string,
  value: unknown,
): FilePlacement | null {
  const fileId = FileIdSchema.safeParse(rkey);
  const body = FilePlacementBodySchema.safeParse(value);
  if (!fileId.success || !body.success) return null;
  return { fileId: fileId.data, folder: body.data.folder };
}
