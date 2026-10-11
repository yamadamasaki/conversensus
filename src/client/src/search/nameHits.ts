/**
 * File をまたぐ検索 (#248) の「名前」の当たりを、開ける行の並びにする
 *
 * 当たりの規則はサイドバーの名前の検索 (`filterByName`) と同じにする — 同じ検索語が、
 * サイドバーとダイアログで違うものを当てないため。ダイアログは一覧で見せるので、
 * 行ごとに**開く先**(File か Sheet) を持たせる。
 *
 * - Folder の名前が当たったら、その Folder の直下の File を「Folder / File」の行にする。
 *   Folder そのものには開く先が無い
 * - File の名前が当たったら「File」の行 (開くと最初の Sheet)
 * - Sheet の名前が当たったら「File / Sheet」の行
 */

import type { FileId, GraphFileListItem, SheetId } from '@conversensus/shared';
import type { FolderNode, FolderTree } from '../folders/folderTree';
import { findNameMatch } from './nameFilter';

export type NameHit = {
  kind: 'folder' | 'file' | 'sheet';
  /** 当たった名前 (色を付ける側) */
  name: string;
  /** 当たった名前の前に置く場所 (「Folder / 」「File / 」)。無ければ空 */
  context: string;
  /** Folder の当たりでは、場所ではなく後ろに置く File の名前 */
  trailing: string;
  fileId: FileId;
  sheetId: SheetId;
};

export function nameHits(
  tree: FolderTree,
  files: readonly GraphFileListItem[],
  query: string,
): NameHit[] {
  if (query.trim() === '') return [];
  const fileById = new Map(files.map((f) => [f.id as FileId, f]));
  const hits: NameHit[] = [];
  const firstSheet = (file: GraphFileListItem) => file.sheets[0]?.id;

  const walk = (node: FolderNode) => {
    if (findNameMatch(node.name, query)) {
      for (const id of node.files) {
        const file = fileById.get(id);
        const sheetId = file && firstSheet(file);
        if (file && sheetId)
          hits.push({
            kind: 'folder',
            name: node.name,
            context: '',
            trailing: ` / ${file.name}`,
            fileId: file.id,
            sheetId,
          });
      }
    }
    for (const child of node.folders) walk(child);
  };
  for (const node of tree.folders) walk(node);

  for (const file of files) {
    const sheetId = firstSheet(file);
    if (sheetId && findNameMatch(file.name, query))
      hits.push({
        kind: 'file',
        name: file.name,
        context: '',
        trailing: '',
        fileId: file.id,
        sheetId,
      });
    for (const sheet of file.sheets) {
      if (findNameMatch(sheet.name, query))
        hits.push({
          kind: 'sheet',
          name: sheet.name,
          context: `${file.name} / `,
          trailing: '',
          fileId: file.id,
          sheetId: sheet.id,
        });
    }
  }
  return hits;
}
