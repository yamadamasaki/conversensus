/**
 * 左サイドバーの Folder (step3 Phase 6 S6-2c)
 *
 * 端末の写し (`FolderReplica`) を持ち、操作を当て、PDS と往復させ、木を導出する。
 *
 * - **同期の契機**: actor が決まったとき・`online`・「今すぐ同期」。操作のたびにも送る
 *   (送れなければ未送信のまま残る)
 * - **受け取った後に名前の重複を解く** (設計 §2.3 / Q4)。どの端末も同じ改名を書くので、
 *   2 台が書いても後勝ちで同じ値になる
 * - **折り畳みは端末ごと** (Q6)
 * - ログインしていない間の写しは、ログインしたらその actor へ引き継ぐ (Q5)
 */

import type { Did, FileId, FolderId, FolderName } from '@conversensus/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { pdsFolderRemote } from '../atproto/folderRemote';
import {
  type FolderReplica,
  folderStorageKey,
  loadReplica,
  saveReplica,
} from '../folders/folderReplica';
import { buildFolderTree } from '../folders/folderTree';
import { safeLocalStorage } from '../sync/safeStorage';
import { generateId } from '../uuid';

/** 折り畳んだ Folder (端末ごと, Q6) */
const COLLAPSED_KEY = 'conversensus.folderCollapsed';

function loadCollapsed(storage: Storage | null): Set<FolderId> {
  try {
    const raw = storage?.getItem(COLLAPSED_KEY) ?? null;
    const value: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(Array.isArray(value) ? (value as FolderId[]) : []);
  } catch {
    return new Set();
  }
}

/** 受け取った後に名前の重複を解く改名を当てる */
function applyRenames(replica: FolderReplica): boolean {
  const { renames } = buildFolderTree(replica.folderList(), [], []);
  for (const { id, name } of renames) replica.renameFolder(id, name);
  return renames.length > 0;
}

export function useFolders(did: Did | null, fileIds: readonly FileId[]) {
  const storage = useMemo(() => safeLocalStorage(), []);
  const remote = did === null ? null : pdsFolderRemote;

  const replica = useMemo(() => {
    const own = loadReplica(storage, did);
    if (did !== null) {
      // ログインしていない間の写しを引き継ぐ (Q5)。引き継いだら手放す
      const local = loadReplica(storage, null);
      if (local.folderList().length > 0 || local.hasPending()) {
        own.adopt(local);
        storage?.removeItem(folderStorageKey(null));
        saveReplica(storage, did, own);
      }
    }
    return own;
  }, [storage, did]);

  /** 写しが変わるたびに進める (描き直しと控えの契機) */
  const [version, setVersion] = useState(0);
  useEffect(
    () =>
      replica.subscribe(() => {
        saveReplica(storage, did, replica);
        setVersion((v) => v + 1);
      }),
    [replica, storage, did],
  );

  const sync = useCallback(async () => {
    if (remote === null) return;
    try {
      await replica.sync(remote);
      if (applyRenames(replica)) await replica.push(remote);
    } catch (err) {
      // 受け取れなかっただけ。未送信は写しに残っている
      console.warn('[folders] sync failed', err);
    }
  }, [replica, remote]);

  useEffect(() => {
    void sync();
    const onOnline = () => void sync();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [sync]);

  /** 操作の後に送る。送れなくても写しには当たっている */
  const pushSoon = useCallback(() => {
    if (remote !== null) void replica.push(remote);
  }, [replica, remote]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version は写しの変化の印
  const tree = useMemo(
    () =>
      buildFolderTree(replica.folderList(), replica.placementList(), fileIds),
    [replica, fileIds, version],
  );

  const createFolder = useCallback(
    (name: FolderName, parent?: FolderId) => {
      replica.createFolder({
        id: generateId() as FolderId,
        name,
        parent,
        createdAt: new Date().toISOString(),
      });
      pushSoon();
    },
    [replica, pushSoon],
  );
  const renameFolder = useCallback(
    (id: FolderId, name: FolderName) => {
      replica.renameFolder(id, name);
      pushSoon();
    },
    [replica, pushSoon],
  );
  const deleteFolder = useCallback(
    (id: FolderId) => {
      replica.deleteFolder(id);
      pushSoon();
    },
    [replica, pushSoon],
  );
  /** File を Folder へ移す。`undefined` ならトップ・レベルに戻す */
  const moveFile = useCallback(
    (fileId: FileId, folder: FolderId | undefined) => {
      if (folder === undefined) replica.unplaceFile(fileId);
      else replica.placeFile(fileId, folder);
      pushSoon();
    },
    [replica, pushSoon],
  );

  const [collapsed, setCollapsed] = useState(() => loadCollapsed(storage));
  const toggleFolder = useCallback(
    (id: FolderId) => {
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        try {
          storage?.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
        } catch {
          // 控えが残らないだけ
        }
        return next;
      });
    },
    [storage],
  );

  return {
    tree,
    collapsed,
    toggleFolder,
    createFolder,
    renameFolder,
    deleteFolder,
    moveFile,
    syncFolders: sync,
  };
}
