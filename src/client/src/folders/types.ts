/**
 * フォルダ (step3 Phase 6 S6-2)
 *
 * actor 固有・端末間共通の state で、op-log には載らない。端末間で併合できるよう、
 * **Folder 1 つ・File の置き場 1 つをそれぞれ 1 項目**として持つ (設計 F7)。
 */

import type {
  FileId,
  FolderId,
  FolderName,
  ISODateString,
} from '@conversensus/shared';

export type Folder = {
  id: FolderId;
  name: FolderName;
  /** 無ければトップ・レベル */
  parent?: FolderId;
  /** 同じ階層で名前が重なったとき、後の方を改名する順序 (設計 §2.3) */
  createdAt: ISODateString;
};

/** File をどの Folder に置いたか。置き場の無い File はトップ・レベルに出る */
export type FilePlacement = {
  fileId: FileId;
  folder: FolderId;
};
