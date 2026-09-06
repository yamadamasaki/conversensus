import { describe, expect, it } from 'bun:test';
import type { Did, FileId, JudgmentBatch } from '@conversensus/shared';
import type { ReadRosterOptions, ReadRosterResult } from './readRoster';
import { createRosterSource } from './rosterSource';

const FILE = '11111111-1111-4111-8111-111111111111' as FileId;
const OTHER_FILE = '22222222-2222-4222-8222-222222222222' as FileId;
const ME = 'did:plc:alice' as Did;

/** 名簿の中身はこのモジュールの関心事ではないので、読めたことだけが分かる形にする */
const result = (tag: string): ReadRosterResult => ({
  participation: {
    participating: new Set(),
    invited: new Map(),
    departed: new Map(),
    history: new Map(),
    rejected: [],
  },
  batches: [{ id: tag } as unknown as JudgmentBatch],
  readRepos: [],
  unreadable: [],
});

/** 呼び出しを数え、解決のタイミングを外から握れる `loadRoster` */
function fakeLoad() {
  const calls: ReadRosterOptions[] = [];
  const pending: Array<(r: ReadRosterResult) => void> = [];
  let auto: ReadRosterResult | null = result('auto');
  let failWith: unknown = null;
  return {
    calls,
    /** 手動解決モードにする (in-flight を観測するため) */
    hold() {
      auto = null;
    },
    /** 保留中の n 番目を解決する */
    settle(index: number, tag: string) {
      pending[index]?.(result(tag));
    },
    failNext(error: unknown) {
      failWith = error;
    },
    fn: (options: ReadRosterOptions): Promise<ReadRosterResult> => {
      calls.push(options);
      if (failWith !== null) {
        const error = failWith;
        failWith = null;
        return Promise.reject(error);
      }
      if (auto) return Promise.resolve(auto);
      return new Promise((resolve) => pending.push(resolve));
    },
  };
}

/** 既定は「起点はある」。true を返す版は読み直しを起こす */
const noGenesisRepair = async () => false;

describe('createRosterSource', () => {
  describe('読み方', () => {
    it('起点を自分にして読む', async () => {
      const load = fakeLoad();
      const source = createRosterSource({
        loadRoster: load.fn,
        ensureOwnGenesis: noGenesisRepair,
        viewer: ME,
      });
      await source.read(FILE);
      expect(load.calls).toEqual([{ fileId: FILE, seed: ME }]);
    });

    it('起点を置いたら読み直す (置く前の名簿は依頼を捨てている)', async () => {
      const load = fakeLoad();
      const seen: JudgmentBatch[][] = [];
      const source = createRosterSource({
        loadRoster: load.fn,
        // 起点が無かったので置いた、を模す
        ensureOwnGenesis: async (_fileId, known) => {
          seen.push([...known]);
          return seen.length === 1;
        },
        viewer: ME,
      });
      await source.read(FILE);
      // 2 回目の読みが本番。1 回目の結果は起点が無い状態の名簿である
      expect(load.calls).toHaveLength(2);
      // 置く判断には**いま読んだ**判断ログを渡す (ここで読み直すと増えた分とずれる)
      expect(seen).toHaveLength(1);
    });

    it('起点を置かなければ 1 回しか読まない', async () => {
      const load = fakeLoad();
      const source = createRosterSource({
        loadRoster: load.fn,
        ensureOwnGenesis: noGenesisRepair,
        viewer: ME,
      });
      await source.read(FILE);
      expect(load.calls).toHaveLength(1);
    });

    it('読めなければ投げる (名簿が空であることと区別する)', async () => {
      const load = fakeLoad();
      load.failNext(new Error('PDS 応答なし'));
      const source = createRosterSource({
        loadRoster: load.fn,
        ensureOwnGenesis: noGenesisRepair,
        viewer: ME,
      });
      await expect(source.read(FILE)).rejects.toThrow('PDS 応答なし');
    });
  });

  describe('同時に走った読みを畳む', () => {
    it('進行中の読みがあれば相乗りする (同期サイクルとダイアログが重なる場面)', async () => {
      const load = fakeLoad();
      load.hold();
      const source = createRosterSource({
        loadRoster: load.fn,
        ensureOwnGenesis: noGenesisRepair,
        viewer: ME,
      });
      const a = source.read(FILE);
      const b = source.read(FILE);
      expect(load.calls).toHaveLength(1);
      load.settle(0, 'one');
      expect(await a).toBe(await b); // 同じ結果を共有する
    });

    it('File が違えば畳まない', async () => {
      const load = fakeLoad();
      load.hold();
      const source = createRosterSource({
        loadRoster: load.fn,
        ensureOwnGenesis: noGenesisRepair,
        viewer: ME,
      });
      void source.read(FILE);
      void source.read(OTHER_FILE);
      expect(load.calls.map((c) => c.fileId)).toEqual([FILE, OTHER_FILE]);
      load.settle(0, 'one');
      load.settle(1, 'two');
    });

    it('前の読みが終わっていれば新しく読む (TTL は持たない)', async () => {
      const load = fakeLoad();
      const source = createRosterSource({
        loadRoster: load.fn,
        ensureOwnGenesis: noGenesisRepair,
        viewer: ME,
      });
      await source.read(FILE);
      await source.read(FILE);
      expect(load.calls).toHaveLength(2);
    });

    it('失敗した読みを残さない (次の呼び出しが再試行できる)', async () => {
      const load = fakeLoad();
      load.failNext(new Error('一時的な失敗'));
      const source = createRosterSource({
        loadRoster: load.fn,
        ensureOwnGenesis: noGenesisRepair,
        viewer: ME,
      });
      await source.read(FILE).catch(() => {});
      await expect(source.read(FILE)).resolves.toBeDefined();
      expect(load.calls).toHaveLength(2);
    });
  });

  describe('readFresh (書き込みの直後)', () => {
    it('進行中の読みに相乗りしない', async () => {
      const load = fakeLoad();
      load.hold();
      const source = createRosterSource({
        loadRoster: load.fn,
        ensureOwnGenesis: noGenesisRepair,
        viewer: ME,
      });
      const stale = source.read(FILE); // 書き込みより前に始まった読み
      const fresh = source.readFresh(FILE); // 書き込みの直後
      expect(load.calls).toHaveLength(2);

      load.settle(0, 'before-write');
      load.settle(1, 'after-write');
      expect((await stale).batches[0]?.id as string).toBe('before-write');
      // **書いた後の名簿が返る。**相乗りしていたら 'before-write' になる
      expect((await fresh).batches[0]?.id as string).toBe('after-write');
    });

    it('readFresh の後の read は新しい方に相乗りする', async () => {
      const load = fakeLoad();
      load.hold();
      const source = createRosterSource({
        loadRoster: load.fn,
        ensureOwnGenesis: noGenesisRepair,
        viewer: ME,
      });
      void source.read(FILE);
      const fresh = source.readFresh(FILE);
      const after = source.read(FILE);
      expect(load.calls).toHaveLength(2); // read は新しく始めない
      load.settle(0, 'before-write');
      load.settle(1, 'after-write');
      expect(await after).toBe(await fresh);
    });

    it('古い読みが後から終わっても、新しい読みを取り下げない', async () => {
      // `finally` が無条件に delete すると、遅れて終わった古い読みが
      // 新しい読みの登録を消してしまい、以後の read が毎回新規になる
      const load = fakeLoad();
      load.hold();
      const source = createRosterSource({
        loadRoster: load.fn,
        ensureOwnGenesis: noGenesisRepair,
        viewer: ME,
      });
      const stale = source.read(FILE);
      const fresh = source.readFresh(FILE);
      load.settle(0, 'before-write'); // 古い方が先に終わる
      await stale;
      const joined = source.read(FILE);
      expect(load.calls).toHaveLength(2); // 新しい読みがまだ登録されている
      load.settle(1, 'after-write');
      expect(await joined).toBe(await fresh);
    });
  });
});
