import { describe, expect, it } from 'bun:test';
import type { Batch, BatchId, FileId, NodeId } from '@conversensus/shared';
import { batchRkey, batchRkeyPrefix } from '../atproto/batchRkey';
import type { RemoteBatch } from '../atproto/types';
import {
  hasRkeyMigrated,
  markRkeyMigrated,
  migrateRemoteRkey,
  RKEY_MIGRATION_STORAGE_PREFIX,
} from './migrateRemoteRkey';

const FILE_A = '11111111-1111-4111-8111-111111111111' as FileId;
const FILE_B = '22222222-2222-4222-8222-222222222222' as FileId;
const LOCAL_ONLY = '33333333-3333-4333-8333-333333333333' as FileId;
const DID = 'did:plc:alice';

const batch = (id: string, clock: number): Batch => ({
  id: id as BatchId,
  actor: 'did:plc:alice#dev-a',
  clock,
  timestamp: 1_700_000_000_000,
  ops: [{ kind: 'node.add', target: id as NodeId, content: id }],
});

/** presentation だけの batch (remote leg のフィルタで落ちるはず, §3.2 D7) */
const styleBatch = (id: string, clock: number): Batch => ({
  id: id as BatchId,
  actor: 'did:plc:alice#dev-a',
  clock,
  timestamp: 1_700_000_000_000,
  ops: [
    { kind: 'node.setStyle', target: id as NodeId, style: { fill: '#f00' } },
  ],
});

/**
 * PDS とローカル正典を模したテスト台。
 *
 * **remote は rkey をキーにした Map** で持つ — 移行の眼目は「レコードが増えないこと」
 * (rkey の決定論性) なので、batch 数ではなく**レコード数**で判定できる形にする。
 * 旧 rkey のレコードは rkey = batchId (Phase 4c〜6 の形式) で置く。
 */
function makeWorld(options?: {
  /** PDS に旧 rkey で置いてある batch (別端末が push した未受信分を含む) */
  remoteOld?: Array<[FileId, Batch]>;
  /** PDS に新 rkey で置いてある batch (p7-1 以降に push された分) */
  remoteNew?: Array<[FileId, Batch]>;
  /** ローカル正典が最初から持っている batch */
  local?: Array<[FileId, Batch]>;
}) {
  const remote = new Map<string, RemoteBatch>();
  for (const [fileId, b] of options?.remoteOld ?? []) {
    remote.set(b.id, { fileId, batch: b }); // 旧形式: rkey = batchId
  }
  for (const [fileId, b] of options?.remoteNew ?? []) {
    remote.set(batchRkey(fileId, b.clock, b.id), { fileId, batch: b });
  }

  const local = new Map<FileId, Batch[]>();
  for (const [fileId, b] of options?.local ?? []) {
    local.set(fileId, [...(local.get(fileId) ?? []), b]);
  }

  const storage = new Map<string, string>();
  const pushedRkeys: string[] = [];
  const appendCalls: Array<{ fileId: FileId; batches: Batch[] }> = [];
  const fetchedFor: FileId[] = [];
  let failPullRemote = false;
  let failPushFor: FileId | null = null;
  let clock = 0;

  const deps = {
    pullAllRemoteForMigration: async () => {
      if (failPullRemote) throw new Error('pullAllRemoteForMigration failed');
      return [...remote.values()];
    },
    appendReceived: async (fileId: FileId, batches: Batch[]) => {
      appendCalls.push({ fileId, batches });
      const existing = local.get(fileId) ?? [];
      const known = new Set(existing.map((b) => b.id));
      // ローカル正典の (file_id, batch_id) べき等性 (EventStore.appendReceivedBatches)
      const fresh = batches.filter((b) => !known.has(b.id));
      local.set(fileId, [...existing, ...fresh]);
      return fresh.length;
    },
    fetchBatches: async (fileId: FileId) => {
      fetchedFor.push(fileId);
      return [...(local.get(fileId) ?? [])];
    },
    // 範囲取得 (p7-2)。**新形式の rkey のレコードしか見えない**のが要 —
    // 旧 rkey は `v1~` より小さく走査に現れないので、移行の差分計算では
    // 「旧形式で載っている」を「載っている」と数えてはいけない
    pullRemoteForFile: async (fileId: FileId) =>
      [...remote.entries()]
        .filter(([rkey]) => rkey.startsWith(batchRkeyPrefix(fileId)))
        .map(([, entry]) => entry),
    // applyWrites#create を模す: **既存 rkey が 1 件でもあればチャンクごと失敗**し、
    // 書込は原子的に巻き戻る (実機で確認済, 設計 §5.4 の観測③④)
    createRemote: async (entries: readonly RemoteBatch[]) => {
      const rkeys = entries.map((e) =>
        batchRkey(e.fileId, e.batch.clock, e.batch.id),
      );
      const conflict = rkeys.find((k) => remote.has(k));
      if (conflict) throw new Error(`create conflict: ${conflict}`);
      for (const e of entries) {
        if (e.fileId === failPushFor)
          throw new Error(`push failed: ${e.fileId}`);
      }
      for (const [i, e] of entries.entries()) {
        const rkey = rkeys[i] as string;
        pushedRkeys.push(rkey);
        remote.set(rkey, e);
      }
    },
    hasMigrated: () => storage.has(DID),
    markMigrated: () => {
      storage.set(DID, 'yes');
    },
    // 呼ぶたび 1 ずつ進む時計 (elapsedMs を決定論的にする)
    now: () => (clock += 1),
  };

  return {
    remote,
    local,
    storage,
    pushedRkeys,
    appendCalls,
    fetchedFor,
    deps,
    failPull() {
      failPullRemote = true;
    },
    failPush(fileId: FileId) {
      failPushFor = fileId;
    },
    localIds: () => [...local.keys()],
  };
}

describe('migrateRemoteRkey (Phase 7 p7-4)', () => {
  it('旧 rkey にしか無い batch を取り込んでから新 rkey で再 push する', async () => {
    // 別端末が旧版で push し、この端末が未受信の batch。新経路 (prefix 走査) からは
    // 見えないので、移行がここで拾わなければ**恒久的に失われる** (設計 §6.2)。
    const w = makeWorld({
      remoteOld: [
        [FILE_A, batch('a1', 1)],
        [FILE_A, batch('a2', 2)],
      ],
      local: [[FILE_A, batch('a1', 1)]], // a2 は未受信
    });

    const result = await migrateRemoteRkey(w.deps);

    expect(result.status).toBe('migrated');
    expect(result.remoteFiles).toBe(1);
    expect(result.receivedBatches).toBe(1); // 新規は a2 だけ
    expect(w.local.get(FILE_A)?.map((b) => b.id)).toEqual(['a1', 'a2']);
    // 取り込んだ a2 を含めて新形式で載せ直す
    expect(result.pushedFiles).toBe(1);
    expect(result.pushedBatches).toBe(2);
    expect(w.pushedRkeys).toEqual([
      batchRkey(FILE_A, 1, 'a1' as BatchId),
      batchRkey(FILE_A, 2, 'a2' as BatchId),
    ]);
  });

  it('2 回実行してもレコードが増えない (rkey の決定論性)', async () => {
    // 受入基準 §5-2「移行のべき等性: 2 回実行してもレコードが増えないこと」。
    // marker を消して 2 回目を回す = 「失敗して再試行した」状況の再現でもある。
    const w = makeWorld({
      remoteOld: [
        [FILE_A, batch('a1', 1)],
        [FILE_B, batch('b1', 1)],
      ],
    });

    await migrateRemoteRkey(w.deps);
    const afterFirst = w.remote.size;
    const firstKeys = [...w.remote.keys()].sort();
    const writesInFirst = w.pushedRkeys.length;

    w.storage.delete(DID);
    const second = await migrateRemoteRkey(w.deps);

    // 2 回目は**1 件も書かない** — まとめ書き (applyWrites#create) は既存 rkey で
    // チャンクごと落ちるので、差分を取れていなければここで例外になる
    expect(w.pushedRkeys.length).toBe(writesInFirst);
    expect(second.pushedBatches).toBe(0);
    expect(second.pushedFiles).toBe(0);
    expect(w.remote.size).toBe(afterFirst);
    expect([...w.remote.keys()].sort()).toEqual(firstKeys);
    // 旧レコードは削除しない (§2.2 非目標) — 新旧が併存したままである
    expect(w.remote.has('a1')).toBe(true);
    expect(w.remote.has(batchRkey(FILE_A, 1, 'a1' as BatchId))).toBe(true);
  });

  it('部分的に失敗したあとのやり直しで、載っていない分だけを書く', async () => {
    // §6.2「marker が立つ前なら何度でもやり直せる」。まとめ書きがべき等でない以上、
    // やり直しの安全性は差分計算に懸かっているので、そこを直接固定する。
    const w = makeWorld({
      remoteOld: [
        [FILE_A, batch('a1', 1)],
        [FILE_B, batch('b1', 1)],
      ],
    });
    w.failPush(FILE_B);
    await expect(migrateRemoteRkey(w.deps)).rejects.toThrow();
    w.pushedRkeys.length = 0;

    w.failPush('' as FileId); // 障害が解消した
    const retry = await migrateRemoteRkey(w.deps);

    // FILE_A は 1 回目に載ったので触らず、FILE_B だけを書く
    expect(retry.pushedFiles).toBe(1);
    expect(w.pushedRkeys).toEqual([batchRkey(FILE_B, 1, 'b1' as BatchId)]);
    expect(w.storage.has(DID)).toBe(true);
  });

  it('marker が立っていれば何もしない', async () => {
    const w = makeWorld({ remoteOld: [[FILE_A, batch('a1', 1)]] });
    w.deps.markMigrated();

    const result = await migrateRemoteRkey(w.deps);

    expect(result).toEqual({
      status: 'already-migrated',
      remoteFiles: 0,
      receivedBatches: 0,
      pushedFiles: 0,
      pushedBatches: 0,
      elapsedMs: 0,
    });
    expect(w.appendCalls).toHaveLength(0);
    expect(w.pushedRkeys).toEqual([]);
  });

  it('全件受信が失敗したら再 push へ進まず marker も立てない', async () => {
    // §6.2: 1 を飛ばして 2 から始めると PDS にしか無い batch を失う。
    // 「1 が失敗 → 2 を実行」も同じ穴なので、例外はそのまま外へ出す。
    const w = makeWorld({ local: [[FILE_A, batch('a1', 1)]] });
    w.failPull();

    await expect(migrateRemoteRkey(w.deps)).rejects.toThrow(
      'pullAllRemoteForMigration failed',
    );
    expect(w.pushedRkeys).toEqual([]);
    expect(w.storage.has(DID)).toBe(false); // 次回起動で再試行できる
  });

  it('再 push が失敗したら marker を立てない (部分成功は許容)', async () => {
    const w = makeWorld({
      remoteOld: [
        [FILE_A, batch('a1', 1)],
        [FILE_B, batch('b1', 1)],
      ],
    });
    w.failPush(FILE_B);

    await expect(migrateRemoteRkey(w.deps)).rejects.toThrow(
      `push failed: ${FILE_B}`,
    );
    // FILE_A は新形式で載っている。べき等なので再実行しても壊れない
    expect(w.remote.has(batchRkey(FILE_A, 1, 'a1' as BatchId))).toBe(true);
    expect(w.storage.has(DID)).toBe(false);
  });

  it('remote に無いローカル専用ファイルは push しない', async () => {
    // 移行は「PDS 上の旧形式レコードを載せ替える」作業であって、未同期のローカル
    // ファイルを送る作業ではない。それは通常の catch-up (ファイルを開いたとき) の担当。
    const w = makeWorld({
      remoteOld: [[FILE_A, batch('a1', 1)]],
      local: [
        [FILE_A, batch('a1', 1)],
        [LOCAL_ONLY, batch('x1', 1)],
      ],
    });

    const result = await migrateRemoteRkey(w.deps);

    expect(result.pushedFiles).toBe(1);
    expect(w.fetchedFor).toEqual([FILE_A]); // LOCAL_ONLY は読みにも行かない
    expect(w.pushedRkeys.some((k) => k.includes(LOCAL_ONLY))).toBe(false);
  });

  it('presentation だけの batch は再 push されない (D7)', async () => {
    const w = makeWorld({
      remoteOld: [[FILE_A, batch('a1', 1)]],
      local: [
        [FILE_A, batch('a1', 1)],
        [FILE_A, styleBatch('a2', 2)],
      ],
    });

    const result = await migrateRemoteRkey(w.deps);

    expect(result.pushedBatches).toBe(1);
    expect(w.pushedRkeys).toEqual([batchRkey(FILE_A, 1, 'a1' as BatchId)]);
  });

  it('remote が空なら何も書かず marker だけ立てる', async () => {
    const w = makeWorld({ local: [[LOCAL_ONLY, batch('x1', 1)]] });

    const result = await migrateRemoteRkey(w.deps);

    expect(result.remoteFiles).toBe(0);
    expect(result.pushedFiles).toBe(0);
    expect(w.appendCalls).toHaveLength(0);
    expect(w.storage.has(DID)).toBe(true); // 移行すべきものが無い = 移行済
  });

  it('新 rkey のレコードだけの repo でも安全に通る (再実行と同じ形)', async () => {
    const w = makeWorld({
      remoteNew: [[FILE_A, batch('a1', 1)]],
      local: [[FILE_A, batch('a1', 1)]],
    });

    const result = await migrateRemoteRkey(w.deps);

    expect(result.receivedBatches).toBe(0); // 既知なので新規追記なし
    expect(w.remote.size).toBe(1); // 上書きされるだけ
  });

  it('複数ファイルを fileId ごとに 1 回ずつ束ねて追記する', async () => {
    const w = makeWorld({
      remoteOld: [
        [FILE_A, batch('a1', 1)],
        [FILE_B, batch('b1', 1)],
        [FILE_A, batch('a2', 2)],
      ],
    });

    const result = await migrateRemoteRkey(w.deps);

    expect(result.remoteFiles).toBe(2);
    expect(w.appendCalls).toHaveLength(2);
    expect(w.appendCalls[0]?.fileId).toBe(FILE_A);
    expect(w.appendCalls[0]?.batches.map((b) => b.id)).toEqual(['a1', 'a2']);
    expect(w.appendCalls[1]?.fileId).toBe(FILE_B);
  });

  it('所要時間を返す (移行コストの実測用, §6.3)', async () => {
    const w = makeWorld({ remoteOld: [[FILE_A, batch('a1', 1)]] });
    const result = await migrateRemoteRkey(w.deps);
    expect(result.elapsedMs).toBeGreaterThan(0);
  });
});

describe('rkey 移行 marker', () => {
  const makeStorage = (): Storage => {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
      clear: () => map.clear(),
      key: (i: number) => [...map.keys()][i] ?? null,
      get length() {
        return map.size;
      },
    };
  };

  it('立てるまでは false、立てたら true', () => {
    const storage = makeStorage();
    expect(hasRkeyMigrated(DID, storage)).toBe(false);
    markRkeyMigrated(DID, storage);
    expect(hasRkeyMigrated(DID, storage)).toBe(true);
  });

  it('DID ごとに独立する (別アカウントは別 repo)', () => {
    const storage = makeStorage();
    markRkeyMigrated(DID, storage);
    expect(hasRkeyMigrated('did:plc:bob', storage)).toBe(false);
  });

  it('キーは DID を含む (端末 × アカウント単位で残る)', () => {
    const storage = makeStorage();
    markRkeyMigrated(DID, storage);
    expect(storage.getItem(RKEY_MIGRATION_STORAGE_PREFIX + DID)).not.toBeNull();
  });

  it('保存に失敗しても例外にしない (移行そのものは成功している)', () => {
    const storage = {
      ...makeStorage(),
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    } as Storage;
    expect(() => markRkeyMigrated('did:plc:carol', storage)).not.toThrow();
  });
});
