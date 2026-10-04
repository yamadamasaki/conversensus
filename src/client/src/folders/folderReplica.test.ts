import { describe, expect, test } from 'bun:test';
import type { FileId, FolderId } from '@conversensus/shared';
import fc from 'fast-check';
import {
  type FolderRemote,
  FolderReplica,
  loadReplica,
  saveReplica,
} from './folderReplica';
import { buildFolderTree } from './folderTree';
import type { Folder } from './types';

const fid = (n: number) =>
  `${String(n).repeat(8)}-0000-4000-8000-000000000000` as FolderId;
const file = (n: number) =>
  `${String(n).repeat(8)}-1111-4111-8111-111111111111` as FileId;
const T1 = '2026-10-01T00:00:00.000Z';
const T2 = '2026-10-02T00:00:00.000Z';
const DID = 'did:plc:alice';

/** PDS を模す。項目ごとの後勝ち (Map への set / delete) */
function fakeRemote() {
  const folders = new Map<FolderId, Folder>();
  const places = new Map<FileId, FolderId>();
  let failing = false;
  const guard = () => {
    if (failing) throw new Error('offline');
  };
  const remote: FolderRemote = {
    listFolders: async () => {
      guard();
      return [...folders.values()];
    },
    listPlacements: async () => {
      guard();
      return [...places].map(([fileId, folder]) => ({ fileId, folder }));
    },
    putFolder: async (f) => {
      guard();
      folders.set(f.id, f);
    },
    deleteFolder: async (id) => {
      guard();
      folders.delete(id);
    },
    putPlacement: async (p) => {
      guard();
      places.set(p.fileId, p.folder);
    },
    deletePlacement: async (fileId) => {
      guard();
      places.delete(fileId);
    },
  };
  return {
    remote,
    folders,
    places,
    setFailing: (v: boolean) => {
      failing = v;
    },
  };
}

/** テスト用の Storage */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => {
      map.delete(k);
    },
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

/** 比べるための写しの姿 (並びに依らない形) */
const stateOf = (r: FolderReplica) => ({
  folders: r.folderList().sort((a, b) => (a.id < b.id ? -1 : 1)),
  placements: r.placementList().sort((a, b) => (a.fileId < b.fileId ? -1 : 1)),
});

describe('FolderReplica: 送る', () => {
  test('オフラインの操作は写しに当たって未送信になり、送ると PDS に載って印が消える', async () => {
    const pds = fakeRemote();
    const r = new FolderReplica();
    r.createFolder({ id: fid(1), name: '研究', createdAt: T1 });
    r.placeFile(file(1), fid(1));
    expect(r.hasPending()).toBe(true);
    await r.push(pds.remote);
    expect(r.hasPending()).toBe(false);
    expect(pds.folders.get(fid(1))?.name).toBe('研究');
    expect(pds.places.get(file(1))).toBe(fid(1));
  });

  test('送れなければ未送信のまま残り、次に送り直す', async () => {
    const pds = fakeRemote();
    const r = new FolderReplica();
    r.createFolder({ id: fid(1), name: '研究', createdAt: T1 });
    pds.setFailing(true);
    await r.push(pds.remote);
    expect(r.hasPending()).toBe(true);
    pds.setFailing(false);
    await r.push(pds.remote);
    expect(pds.folders.has(fid(1))).toBe(true);
    expect(r.hasPending()).toBe(false);
  });

  test('送っている間に同じ項目を変えたら、印は残って新しい値が後で送られる', async () => {
    const pds = fakeRemote();
    const r = new FolderReplica();
    r.createFolder({ id: fid(1), name: '旧', createdAt: T1 });
    const put = pds.remote.putFolder;
    pds.remote.putFolder = async (f) => {
      await put(f);
      r.renameFolder(fid(1), '新'); // 送り終える前に変える
    };
    await r.push(pds.remote);
    expect(r.hasPending()).toBe(true);
    pds.remote.putFolder = put;
    await r.push(pds.remote);
    expect(pds.folders.get(fid(1))?.name).toBe('新');
  });

  test('消した Folder と、トップ・レベルに戻した File は PDS から消える', async () => {
    const pds = fakeRemote();
    const r = new FolderReplica();
    r.createFolder({ id: fid(1), name: 'a', createdAt: T1 });
    r.placeFile(file(1), fid(1));
    await r.push(pds.remote);
    r.unplaceFile(file(1));
    r.deleteFolder(fid(1));
    await r.push(pds.remote);
    expect(pds.folders.size).toBe(0);
    expect(pds.places.size).toBe(0);
  });
});

describe('FolderReplica: 受け取る', () => {
  test('未送信でない項目は PDS の値に揃い、PDS に無い項目は消える', async () => {
    const pds = fakeRemote();
    const a = new FolderReplica();
    const b = new FolderReplica();
    a.createFolder({ id: fid(1), name: 'a', createdAt: T1 });
    a.createFolder({ id: fid(2), name: 'b', createdAt: T1 });
    await a.sync(pds.remote);
    await b.pull(pds.remote);
    a.deleteFolder(fid(2));
    a.renameFolder(fid(1), 'a2');
    await a.sync(pds.remote);
    await b.pull(pds.remote);
    expect(stateOf(b)).toEqual(stateOf(a));
  });

  test('未送信の変更は、PDS の古い値で上書きされない', async () => {
    const pds = fakeRemote();
    const r = new FolderReplica();
    r.createFolder({ id: fid(1), name: '旧', createdAt: T1 });
    await r.sync(pds.remote);
    r.renameFolder(fid(1), '新');
    await r.pull(pds.remote);
    expect(r.folderList()[0]?.name).toBe('新');
  });
});

describe('FolderReplica: 端末の控えと引き継ぎ', () => {
  test('控えて読み直すと、未送信の印も含めて元に戻る', async () => {
    const storage = memoryStorage();
    const r = new FolderReplica();
    r.createFolder({ id: fid(1), name: 'a', createdAt: T1 });
    r.placeFile(file(1), fid(1));
    saveReplica(storage, DID, r);
    const back = loadReplica(storage, DID);
    expect(stateOf(back)).toEqual(stateOf(r));
    expect(back.hasPending()).toBe(true);
    const pds = fakeRemote();
    await back.push(pds.remote);
    expect(pds.folders.has(fid(1))).toBe(true);
  });

  test('壊れた控え・無い控えは空の写し', () => {
    const storage = memoryStorage();
    storage.setItem('conversensus.folders.local', '{oops');
    expect(loadReplica(storage, null).folderList()).toEqual([]);
    expect(loadReplica(null, DID).folderList()).toEqual([]);
  });

  test('ログインしていない間の写しは、ログインした actor へ未送信として引き継ぐ (Q5)', async () => {
    const local = new FolderReplica();
    local.createFolder({ id: fid(1), name: 'a', createdAt: T1 });
    local.placeFile(file(1), fid(1));
    const signedIn = new FolderReplica();
    signedIn.adopt(local);
    const pds = fakeRemote();
    await signedIn.push(pds.remote);
    expect(pds.folders.has(fid(1))).toBe(true);
    expect(pds.places.get(file(1))).toBe(fid(1));
  });
});

describe('2 台の同時編集', () => {
  test('2 台がオフラインで同じ名前の Folder を作ると、同期後に後の方が「名前 (2)」になって揃う', async () => {
    const pds = fakeRemote();
    const a = new FolderReplica();
    const b = new FolderReplica();
    a.createFolder({ id: fid(1), name: '研究', createdAt: T1 });
    b.createFolder({ id: fid(2), name: '研究', createdAt: T2 });
    await a.sync(pds.remote);
    await b.sync(pds.remote);
    await a.pull(pds.remote);

    // どちらの端末も同じ改名を見つけて書く
    for (const r of [a, b]) {
      for (const { id, name } of buildFolderTree(r.folderList(), [], [])
        .renames) {
        r.renameFolder(id, name);
      }
    }
    await a.sync(pds.remote);
    await b.sync(pds.remote);
    await a.pull(pds.remote);
    expect(stateOf(a)).toEqual(stateOf(b));
    expect(
      a
        .folderList()
        .map((f) => f.name)
        .sort(),
    ).toEqual(['研究', '研究 (2)']);
  });

  test('どんな操作と同期の順でも、最後に両方が送って受け取れば 2 台と PDS は揃う', async () => {
    const IDS = [1, 2, 3].map(fid);
    const FILES = [1, 2].map(file);
    const arbOp = fc.oneof(
      fc.record({
        kind: fc.constant('create' as const),
        id: fc.constantFrom(...IDS),
        name: fc.constantFrom('a', 'b'),
      }),
      fc.record({
        kind: fc.constant('rename' as const),
        id: fc.constantFrom(...IDS),
        name: fc.constantFrom('a', 'b', 'c'),
      }),
      fc.record({
        kind: fc.constant('delete' as const),
        id: fc.constantFrom(...IDS),
      }),
      fc.record({
        kind: fc.constant('place' as const),
        fileId: fc.constantFrom(...FILES),
        id: fc.constantFrom(...IDS),
      }),
      fc.record({
        kind: fc.constant('unplace' as const),
        fileId: fc.constantFrom(...FILES),
      }),
      fc.record({ kind: fc.constant('sync' as const) }),
    );
    const arbStep = fc.record({ device: fc.constantFrom(0, 1), op: arbOp });

    await fc.assert(
      fc.asyncProperty(fc.array(arbStep, { maxLength: 20 }), async (steps) => {
        const pds = fakeRemote();
        const devices = [new FolderReplica(), new FolderReplica()];
        for (const { device, op } of steps) {
          const r = devices[device] as FolderReplica;
          switch (op.kind) {
            case 'create':
              r.createFolder({ id: op.id, name: op.name, createdAt: T1 });
              break;
            case 'rename':
              r.renameFolder(op.id, op.name);
              break;
            case 'delete':
              r.deleteFolder(op.id);
              break;
            case 'place':
              r.placeFile(op.fileId, op.id);
              break;
            case 'unplace':
              r.unplaceFile(op.fileId);
              break;
            case 'sync':
              await r.sync(pds.remote);
              break;
          }
        }
        const [a, b] = devices as [FolderReplica, FolderReplica];
        await a.sync(pds.remote);
        await b.sync(pds.remote);
        await a.pull(pds.remote);
        const remote = {
          folders: [...pds.folders.values()].sort((x, y) =>
            x.id < y.id ? -1 : 1,
          ),
          placements: [...pds.places]
            .map(([fileId, folder]) => ({ fileId, folder }))
            .sort((x, y) => (x.fileId < y.fileId ? -1 : 1)),
        };
        expect(stateOf(a)).toEqual(remote);
        expect(stateOf(b)).toEqual(remote);
        expect(a.hasPending() || b.hasPending()).toBe(false);
      }),
    );
  });
});
