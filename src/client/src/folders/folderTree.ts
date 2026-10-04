/**
 * Folder の木を導出する (step3 Phase 6 S6-2a, 設計 §2.3)
 *
 * Folder と File の置き場は項目ごとに端末間で併合されるので、**どの組み合わせが来ても
 * 表示できなければならない**。仕様の制約 (同じ階層で名前が重ならない・行き先がある) は
 * 同期の時点で破れうるので、ここで次のように解く。
 *
 * | 起きること | 解き方 |
 * | --- | --- |
 * | 同じ階層で名前が重なる | 作成日時 (同じなら id) の後の方を「名前 (2)」にする。改名は `renames` に出し、呼び出し側が書く (Q4) |
 * | 親の Folder が無い (親が輪になっている) | トップ・レベルに出す |
 * | File の行き先の Folder が無い | トップ・レベルに出す |
 * | 一覧に無い File (削除済み・共有が外れた) | 黙って外す |
 *
 * **入力の並びに依らない。**同じ集合からは同じ木と同じ改名が出るので、2 台が同時に改名を
 * 書いても後勝ちで同じ値になる。改名を当てた入力からは改名が出ない (収束する)。
 */

import type { FileId, FolderId, FolderName } from '@conversensus/shared';
import type { FilePlacement, Folder } from './types';

export type FolderNode = {
  folder: Folder;
  /** 表示する名前。重複を解いた後の名前で、改名を書く前から使う */
  name: FolderName;
  folders: FolderNode[];
  files: FileId[];
};

export type FolderTree = {
  /** トップ・レベルの Folder (名前順) */
  folders: FolderNode[];
  /** トップ・レベルの File (一覧の順) */
  files: FileId[];
  /** 重複を解くために書くべき改名 */
  renames: { id: FolderId; name: FolderName }[];
};

/** 同じ階層で先に作られた方。作成日時が同じなら id で決める (どの端末でも同じ順) */
function createdBefore(a: Folder, b: Folder): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 名前の重複を解いた後の名前。「名前 (2)」「名前 (3)」… の空いている最初のもの */
function freeName(name: FolderName, taken: ReadonlySet<FolderName>) {
  if (!taken.has(name)) return name;
  for (let k = 2; ; k += 1) {
    const candidate = `${name} (${k})`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** 親を辿って自分に戻るか (輪の中に居るか) */
function inCycle(folder: Folder, byId: ReadonlyMap<FolderId, Folder>): boolean {
  const seen = new Set<FolderId>();
  let cursor = folder.parent;
  while (cursor !== undefined && byId.has(cursor) && !seen.has(cursor)) {
    if (cursor === folder.id) return true;
    seen.add(cursor);
    cursor = byId.get(cursor)?.parent;
  }
  return false;
}

/**
 * 表示上の親。親が無いか、**自分が輪の中に居る**ならトップ・レベル (`undefined`)。
 *
 * 輪の外から輪の中の Folder にぶら下がっている Folder は親を保つ — 輪の Folder が
 * トップ・レベルに出るので、その下に着く。Folder の移動は入れていない (Q3) ので輪は
 * 普通には起きないが、他の端末が書いたレコードは信用しない
 */
function effectiveParents(
  byId: ReadonlyMap<FolderId, Folder>,
): Map<FolderId, FolderId | undefined> {
  const parentOf = new Map<FolderId, FolderId | undefined>();
  for (const folder of byId.values()) {
    const parent = folder.parent;
    const attached =
      parent !== undefined && byId.has(parent) && !inCycle(folder, byId);
    parentOf.set(folder.id, attached ? parent : undefined);
  }
  return parentOf;
}

export function buildFolderTree(
  folders: readonly Folder[],
  placements: readonly FilePlacement[],
  files: readonly FileId[],
): FolderTree {
  // 同じ id が 2 つ来たら先に作られた方を採る (PDS では起きないが、入力の並びに依らせる)
  const byId = new Map<FolderId, Folder>();
  for (const folder of [...folders].sort(createdBefore)) {
    if (!byId.has(folder.id)) byId.set(folder.id, folder);
  }
  const parentOf = effectiveParents(byId);

  const childrenOf = new Map<FolderId | undefined, Folder[]>();
  for (const folder of byId.values()) {
    const parent = parentOf.get(folder.id);
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), folder]);
  }

  // 同じ階層の名前の重複を、先に作られた方から順に解く
  const renames: FolderTree['renames'] = [];
  const nameOf = new Map<FolderId, FolderName>();
  for (const siblings of childrenOf.values()) {
    const taken = new Set<FolderName>();
    for (const folder of [...siblings].sort(createdBefore)) {
      const name = freeName(folder.name, taken);
      taken.add(name);
      nameOf.set(folder.id, name);
      if (name !== folder.name) renames.push({ id: folder.id, name });
    }
  }

  // 置き場は一覧の File から引くので、一覧に無い File (削除済み・共有が外れた) の置き場は
  // 使われずに黙って外れる
  const placed = new Map<FileId, FolderId>();
  for (const p of placements) {
    if (byId.has(p.folder)) placed.set(p.fileId, p.folder);
  }
  const filesIn = new Map<FolderId | undefined, FileId[]>();
  for (const fileId of new Set(files)) {
    const folder = placed.get(fileId);
    filesIn.set(folder, [...(filesIn.get(folder) ?? []), fileId]);
  }

  const build = (parent: FolderId | undefined): FolderNode[] =>
    (childrenOf.get(parent) ?? [])
      .map((folder) => ({
        folder,
        name: nameOf.get(folder.id) ?? folder.name,
        folders: build(folder.id),
        files: filesIn.get(folder.id) ?? [],
      }))
      .sort((a, b) =>
        a.name === b.name
          ? createdBefore(a.folder, b.folder)
          : a.name < b.name
            ? -1
            : 1,
      );

  return {
    folders: build(undefined),
    files: filesIn.get(undefined) ?? [],
    renames: renames.sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
}

/**
 * Folder を削除できるか (空のときだけ, 仕様)。木から引くので、削除された File しか
 * 持たない Folder は空とみなされる (見た目が空なのに消せない Folder を作らない)
 */
export function isEmptyFolder(node: FolderNode): boolean {
  return node.folders.length === 0 && node.files.length === 0;
}
