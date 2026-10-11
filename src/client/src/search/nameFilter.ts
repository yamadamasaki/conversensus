/**
 * 左サイドバーの名前の検索 (#249)
 *
 * design language「トップ・レベルで File 名, Sheet 名あるいは Folder 名での検索ができる」。
 * 結果は**ツリーをその場で絞って**見せる (利用者判断 2026-10-11)。ここはその絞り方だけを決める
 * 純粋な関数で、描き方は `Sidebar` が持つ。
 *
 * ## 何を残すか
 *
 * - 名前が当たった **Folder は中身ごと**残す — Folder で探す人は、その中を見たい
 * - 名前が当たった **File** を残す
 * - **Sheet** が当たった File も残し、当たった Sheet を `matchedSheets` に挙げる。開いていない File の
 *   Sheet も引けるのは、一覧が Sheet の名前を持つから (`GraphFileListItem.sheets`)
 * - 残したものを含む Folder は、名前が当たらなくても残す (場所が分からなくなるので)
 *
 * 当たりは大文字・小文字を区別しない部分一致。前後の空白は無視し、空なら絞らない (null)。
 */

import type { FileId, GraphFileListItem } from '@conversensus/shared';
import type { FolderNode, FolderTree } from '../folders/folderTree';

export type SheetNameItem = GraphFileListItem['sheets'][number];

export type NameFilterResult = {
  /** 絞った後のツリー。Folder の並びと File の並びは元のまま */
  tree: FolderTree;
  /** File ごとの、名前が当たった Sheet (当たった Sheet が無い File は載らない) */
  matchedSheets: ReadonlyMap<FileId, readonly SheetNameItem[]>;
};

/** 名前の中で当たった範囲。無ければ null */
export function findNameMatch(
  name: string,
  query: string,
): { start: number; length: number } | null {
  const q = query.trim().toLocaleLowerCase();
  if (q === '') return null;
  const start = name.toLocaleLowerCase().indexOf(q);
  return start < 0 ? null : { start, length: q.length };
}

const matches = (name: string, query: string) =>
  findNameMatch(name, query) !== null;

export function filterByName(
  tree: FolderTree,
  files: readonly GraphFileListItem[],
  query: string,
): NameFilterResult | null {
  if (query.trim() === '') return null;
  const fileById = new Map(files.map((f) => [f.id as FileId, f]));
  const matchedSheets = new Map<FileId, SheetNameItem[]>();

  /** File を残すか。当たった Sheet もここで集める */
  const keepFile = (id: FileId): boolean => {
    const file = fileById.get(id);
    if (file === undefined) return false;
    const sheets = file.sheets.filter((s) => matches(s.name, query));
    if (sheets.length > 0) matchedSheets.set(id, sheets);
    return matches(file.name, query) || sheets.length > 0;
  };

  /** Folder を絞る。何も残らなければ null */
  const filterFolder = (node: FolderNode): FolderNode | null => {
    if (matches(node.name, query)) {
      // 中身ごと残す。中の Sheet の当たりは集めておく (行に色を付けるため)
      collectAll(node);
      return node;
    }
    const folders = node.folders
      .map(filterFolder)
      .filter((n): n is FolderNode => n !== null);
    const kept = node.files.filter(keepFile);
    if (folders.length === 0 && kept.length === 0) return null;
    return { ...node, folders, files: kept };
  };

  const collectAll = (node: FolderNode): void => {
    for (const id of node.files) keepFile(id);
    for (const child of node.folders) collectAll(child);
  };

  return {
    tree: {
      folders: tree.folders
        .map(filterFolder)
        .filter((n): n is FolderNode => n !== null),
      files: tree.files.filter(keepFile),
      // 絞ったツリーは描くためだけのもの。改名を書くのは元のツリーの仕事 (useFolders)
      renames: [],
    },
    matchedSheets,
  };
}
