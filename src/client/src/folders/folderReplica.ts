/**
 * Folder と File の置き場の、端末の写し (step3 Phase 6 S6-2b, 設計 §2.4)
 *
 * Folder の操作は**オフラインでもできる** (仕様)。操作はまず写しに当て、変えた項目に
 * 「未送信」の印を付け、オンラインで PDS に送る。
 *
 * - **項目ごとの後勝ち**: Folder 1 つ・置き場 1 つが PDS の record 1 つ (設計 F7)。送るのは
 *   未送信の項目の**いまの値**だけなので、キューではなく集合で足りる (順序が要らない)
 * - **受け取り (`pull`) は未送信でない項目だけを差し替える。**送る前の手元の変更を
 *   PDS の古い値で上書きしない
 * - **送っている間に同じ項目を変えたら、印を残す** (版で見分ける)。送り終えた古い値で
 *   印を消すと、新しい変更が送られずに残る
 *
 * 写しは localStorage に actor (DID) ごとに置く。ログインしていない間の写しは、ログイン
 * したらその actor へ未送信として引き継ぐ (設計 Q5)。
 */

import type { Did, FileId, FolderId, FolderName } from '@conversensus/shared';
import type { FilePlacement, Folder } from './types';

/** PDS 側の口。テストでは偽物を渡す */
export type FolderRemote = {
  listFolders: () => Promise<Folder[]>;
  listPlacements: () => Promise<FilePlacement[]>;
  putFolder: (folder: Folder) => Promise<void>;
  deleteFolder: (id: FolderId) => Promise<void>;
  putPlacement: (placement: FilePlacement) => Promise<void>;
  deletePlacement: (fileId: FileId) => Promise<void>;
};

/** 未送信の項目の鍵。Folder と置き場は id の空間が違うので種別を前に付ける */
type ItemKey = `folder:${string}` | `place:${string}`;

const folderKey = (id: FolderId): ItemKey => `folder:${id}`;
const placeKey = (fileId: FileId): ItemKey => `place:${fileId}`;

/** localStorage の形 */
type Persisted = {
  folders: Folder[];
  placements: [FileId, FolderId][];
  dirty: ItemKey[];
};

const STORAGE_KEY_PREFIX = 'conversensus.folders';
const LOCAL_ACTOR = 'local';

export function folderStorageKey(did: Did | null): string {
  return `${STORAGE_KEY_PREFIX}.${did ?? LOCAL_ACTOR}`;
}

export class FolderReplica {
  private folders = new Map<FolderId, Folder>();
  private placements = new Map<FileId, FolderId>();
  /** 未送信の項目 → 版。版は変えるたびに進む */
  private dirty = new Map<ItemKey, number>();
  private version = 0;
  private readonly listeners = new Set<() => void>();

  // --- 読む ---

  folderList(): Folder[] {
    return [...this.folders.values()];
  }

  placementList(): FilePlacement[] {
    return [...this.placements].map(([fileId, folder]) => ({ fileId, folder }));
  }

  /** 未送信の項目があるか (表示用) */
  hasPending(): boolean {
    return this.dirty.size > 0;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // --- 操作 (写しに当てて未送信にする) ---

  createFolder(input: {
    id: FolderId;
    name: FolderName;
    parent?: FolderId;
    createdAt: string;
  }): Folder {
    const folder: Folder = {
      id: input.id,
      name: input.name,
      createdAt: input.createdAt,
      ...(input.parent === undefined ? {} : { parent: input.parent }),
    };
    this.folders.set(folder.id, folder);
    this.touch(folderKey(folder.id));
    return folder;
  }

  renameFolder(id: FolderId, name: FolderName): void {
    const folder = this.folders.get(id);
    if (folder === undefined || folder.name === name) return;
    this.folders.set(id, { ...folder, name });
    this.touch(folderKey(id));
  }

  /** 空かどうかは呼び出し側が木で確かめる (`isEmptyFolder`) */
  deleteFolder(id: FolderId): void {
    if (!this.folders.delete(id)) return;
    this.touch(folderKey(id));
  }

  placeFile(fileId: FileId, folder: FolderId): void {
    if (this.placements.get(fileId) === folder) return;
    this.placements.set(fileId, folder);
    this.touch(placeKey(fileId));
  }

  /** トップ・レベルに戻す = 置き場を消す */
  unplaceFile(fileId: FileId): void {
    if (!this.placements.delete(fileId)) return;
    this.touch(placeKey(fileId));
  }

  // --- PDS との往復 ---

  /**
   * 未送信の項目を送る。1 件ずつ送り、送れたものから印を消す。**送れなかったものは印が
   * 残り、次の機会に送り直す** (例外にしない)。送っている間に変わった項目は印を残す
   */
  async push(remote: FolderRemote): Promise<void> {
    for (const [key, sentVersion] of [...this.dirty]) {
      try {
        await this.send(remote, key);
      } catch (err) {
        console.warn('[folders] failed to send', key, err);
        continue;
      }
      if (this.dirty.get(key) === sentVersion) this.dirty.delete(key);
    }
    this.changed();
  }

  /** PDS の値で、未送信でない項目を差し替える (PDS に無い項目は消す) */
  async pull(remote: FolderRemote): Promise<void> {
    const [folders, placements] = await Promise.all([
      remote.listFolders(),
      remote.listPlacements(),
    ]);
    const remoteFolders = new Map(folders.map((f) => [f.id, f]));
    const remotePlaces = new Map(placements.map((p) => [p.fileId, p.folder]));

    for (const id of new Set([
      ...this.folders.keys(),
      ...remoteFolders.keys(),
    ])) {
      if (this.dirty.has(folderKey(id))) continue;
      const value = remoteFolders.get(id);
      if (value === undefined) this.folders.delete(id);
      else this.folders.set(id, value);
    }
    for (const fileId of new Set([
      ...this.placements.keys(),
      ...remotePlaces.keys(),
    ])) {
      if (this.dirty.has(placeKey(fileId))) continue;
      const value = remotePlaces.get(fileId);
      if (value === undefined) this.placements.delete(fileId);
      else this.placements.set(fileId, value);
    }
    this.changed();
  }

  /**
   * 送ってから受け取る。この順なら、受け取った時点で自分の変更も PDS に載っていて、
   * 写しは PDS と揃う (送れなかった項目は未送信のまま残り、受け取りでも上書きされない)
   */
  async sync(remote: FolderRemote): Promise<void> {
    await this.push(remote);
    await this.pull(remote);
  }

  // --- 端末の控え ---

  toPersisted(): Persisted {
    return {
      folders: this.folderList(),
      placements: [...this.placements],
      dirty: [...this.dirty.keys()],
    };
  }

  static fromPersisted(value: Persisted | null): FolderReplica {
    const replica = new FolderReplica();
    if (value === null) return replica;
    for (const f of value.folders) replica.folders.set(f.id, f);
    for (const [fileId, folder] of value.placements) {
      replica.placements.set(fileId, folder);
    }
    for (const key of value.dirty) replica.touch(key, false);
    return replica;
  }

  /**
   * ログインしていない間の写しを引き継ぐ (Q5)。
   *
   * ログインしていない写しは送り先を持たないので、**持っている項目はすべて未送信**である。
   * 値を写し、未送信の印 (消したという印も) をそのまま引き継げば、どれもこの actor の
   * PDS へ送られる
   */
  adopt(other: FolderReplica): void {
    for (const f of other.folders.values()) this.folders.set(f.id, f);
    for (const [fileId, folder] of other.placements) {
      this.placements.set(fileId, folder);
    }
    for (const key of other.dirty.keys()) this.touch(key, false);
    this.changed();
  }

  // --- 内側 ---

  private touch(key: ItemKey, notify = true): void {
    this.version += 1;
    this.dirty.set(key, this.version);
    if (notify) this.changed();
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  /** 項目のいまの値を送る。写しに無ければ消す */
  private async send(remote: FolderRemote, key: ItemKey): Promise<void> {
    if (key.startsWith('folder:')) {
      const id = key.slice('folder:'.length) as FolderId;
      const folder = this.folders.get(id);
      if (folder === undefined) await remote.deleteFolder(id);
      else await remote.putFolder(folder);
      return;
    }
    const fileId = key.slice('place:'.length) as FileId;
    const folder = this.placements.get(fileId);
    if (folder === undefined) await remote.deletePlacement(fileId);
    else await remote.putPlacement({ fileId, folder });
  }
}

/** localStorage から読む。無い・壊れていれば空の写し */
export function loadReplica(
  storage: Storage | null,
  did: Did | null,
): FolderReplica {
  try {
    const raw = storage?.getItem(folderStorageKey(did)) ?? null;
    if (raw === null) return new FolderReplica();
    const value = JSON.parse(raw) as Persisted;
    const ok =
      Array.isArray(value?.folders) &&
      Array.isArray(value.placements) &&
      Array.isArray(value.dirty);
    return FolderReplica.fromPersisted(ok ? value : null);
  } catch {
    return new FolderReplica();
  }
}

export function saveReplica(
  storage: Storage | null,
  did: Did | null,
  replica: FolderReplica,
): void {
  try {
    storage?.setItem(
      folderStorageKey(did),
      JSON.stringify(replica.toPersisted()),
    );
  } catch (err) {
    console.warn('[folders] failed to save folders', err);
  }
}
