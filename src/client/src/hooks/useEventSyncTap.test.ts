import { afterEach, describe, expect, it } from 'bun:test';
import type { Batch, EdgeId, FileId, NodeId } from '@conversensus/shared';

/**
 * 受信の書き込み先を記録する (Phase 4d-5)。フックの `appendReceived` オプションへ
 * 注入するので実 fetch は走らない。**受信が実際に発火したか**を観測できるようにする —
 * フック側は受信失敗を `.catch` で握るため、これが無いと「何も起きていない」と
 * 「静かに失敗した」を区別できない (W3d5-7 の「400 が無言」の教訓)。
 *
 * **`mock.module` は使わない** — bun のモジュールモックは**プロセス全体に効く**ので、
 * 他のテストファイルが同じモジュールの本物の挙動に依存していると壊れる。
 *
 * 実際に壊れた (2026-09-01)。このファイルを含む 4 つが「import が重いから」という理由で
 * `mock.module('zod', ...)` を置いており、**zod を使う無関係なモジュールの実行時挙動まで
 * 壊れていた** (`safeParse` の結果が proxy を返す)。単体では通り、全体で回したときだけ
 * 落ちるので原因に辿り着きにくい。4 つとも外しても全テストが通る = **もう不要だった**。
 */
/** この端末の DID (既定の `batch()` の著者) */
const MY_DID = 'did:plc:alice';
/** この端末の操作主体 `<did>#<deviceId>` (Phase 4d-2) */
const MY_ACTOR = `${MY_DID}#dev-test` as import('@conversensus/shared').Actor;
/**
 * 名簿を返すだけの供給元 (step2 Phase 2)。中身は 2 点だけが関心事である —
 * **判断ログの clock** (tap がこれを観測しないと参加直後の編集が「参加より前」になる) と、
 * **参加者に自分がいるか** (いなければ他 actor の repo を読まない)。
 */
const rosterWith = (judgmentClock: number, participants = [MY_DID]) => {
  const result = {
    participation: {
      participating: new Set(participants),
      invited: new Map(),
      departed: new Map(),
      history: new Map(),
      rejected: [],
    },
    batches: [
      {
        id: 'j1',
        actor: MY_ACTOR,
        clock: judgmentClock,
        timestamp: 0,
        ops: [],
      },
    ],
    readRepos: [],
    unreadable: [],
    // biome-ignore lint/suspicious/noExplicitAny: テスト用の最小の名簿
  } as any;
  return { read: async () => result, readFresh: async () => result };
};

const receivedWrites: Array<{ fileId: FileId; batches: Batch[] }> = [];
let receiveFails: Error | null = null;
const appendReceived = async (fileId: FileId, batches: Batch[]) => {
  if (receiveFails) throw receiveFails;
  receivedWrites.push({ fileId, batches });
  return batches.length;
};

const { renderHook, act, cleanup } = await import('@testing-library/react');
const { useEventSyncTap } = await import('./useEventSyncTap');

import type { RemoteBatchTarget } from '../atproto/remoteSyncQueue';
import type { RemoteBatch, RemoteFileEntry } from '../atproto/types';

const { RemoteSyncQueue } = await import('../atproto/remoteSyncQueue');
const { GENESIS_ACTOR } = await import('@conversensus/shared');
type SyncProvider = import('../sync/syncProvider').SyncProvider;
type Cursor = import('../sync/syncProvider').Cursor;
type PullResult = import('../sync/syncProvider').PullResult;

const FID = '00000000-0000-4000-8000-00000000f11e' as FileId;

let seq = 0;
const uuid = () => {
  seq += 1;
  return `${seq.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
};

/** node.setContent を 1 件生む content イベント (ops あり) */
const relabel = () => ({
  id: uuid(),
  timestamp: Date.now(),
  category: 'content' as const,
  type: 'NODE_RELABELED' as const,
  nodeId: uuid() as NodeId,
  from: 'a',
  to: 'b',
});

/**
 * presentation op (`edge.setStyle`) だけを生むイベント。
 * NODE_STYLE_CHANGED は実体が width/height なので `node.setLayout` に正規化され
 * **同期対象** (D7)。presentation を試すにはエッジの見た目を使う。
 */
const restyle = () => ({
  id: uuid(),
  timestamp: Date.now(),
  category: 'presentation' as const,
  type: 'EDGE_STYLE_CHANGED' as const,
  edgeId: uuid() as EdgeId,
  from: {},
  to: { stroke: '#f00' },
});

class RecordingProvider implements SyncProvider, RemoteBatchTarget {
  pushed: Batch[] = [];
  /** pull が返す既存ログ (local では Lamport 復元と catch-up の元ネタになる) */
  existing: Batch[] = [];
  async pushRemote(entries: readonly RemoteBatch[]): Promise<void> {
    return this.push(entries.map((e) => e.batch));
  }
  async push(batches: Batch[]): Promise<void> {
    this.pushed.push(...batches);
  }
  async pull(_since: Cursor): Promise<PullResult> {
    return { batches: this.existing, cursor: '' };
  }
  /** remote 側の全件取得 (Phase 4d-4)。p7-5 以降は移行だけが使う */
  async pullAllRemoteForMigration(): Promise<RemoteBatch[]> {
    return this.existing.map((batch) => ({ fileId: FID, batch }));
  }
  /** ファイル単位の取得 (Phase 7 p7-2)。要求された fileId を記録する */
  pulledFor: FileId[] = [];
  async pullRemoteForFile(fileId: FileId): Promise<RemoteBatch[]> {
    this.pulledFor.push(fileId);
    return (await this.pullAllRemoteForMigration()).filter(
      (e) => e.fileId === fileId,
    );
  }
  /** ファイル列挙 (Phase 7 p7-3)。この hook のテストでは 1 ファイルしか扱わない */
  async listRemoteFiles(): Promise<RemoteFileEntry[]> {
    return [{ fileId: FID, deleted: false }];
  }
}

const batch = (id: string, over: Partial<Batch> = {}): Batch => ({
  id: id as Batch['id'],
  actor: MY_DID,
  clock: 1,
  timestamp: 1_700_000_000_000,
  ops: [{ kind: 'node.add', target: id as NodeId, content: id }],
  ...over,
});

afterEach(() => {
  cleanup();
  // 受信モックの記録・失敗設定をテスト間で持ち越さない
  receivedWrites.length = 0;
  receiveFails = null;
});

/** local provider を差し替えた tap を張る。remoteQueue を渡すと fanout 構成になる */
async function renderTap(opts: {
  local: RecordingProvider;
  remoteQueue?: InstanceType<typeof RemoteSyncQueue> | null;
  fileId?: FileId | null;
  onReceived?: Parameters<typeof useEventSyncTap>[1]['onReceived'];
  /** 受信サイクルが最後まで走った合図 (step2 Phase 2 S6) */
  onSynced?: Parameters<typeof useEventSyncTap>[1]['onSynced'];
  /** 定期同期の間隔 (step2 Phase 2 S4)。既定は本番と同じ 30 秒 = テスト中は発火しない */
  pollIntervalMs?: number;
  /** 名簿の供給元 (step2 Phase 2 S2)。省略すると自分の repo だけを見る */
  roster?: Parameters<typeof useEventSyncTap>[1]['roster'];
}) {
  const createLocalProvider = () => opts.local;
  const view = renderHook(() =>
    useEventSyncTap(opts.fileId === undefined ? FID : opts.fileId, {
      remoteQueue: opts.remoteQueue ?? null,
      // **必須の option である。**渡さないと tap が actor 無しの batch を作り、
      // remote leg の著者フィルタ (S0) がそこで落ちる。型は tsconfig.app.json が
      // test を exclude しているため通ってしまう
      actor: MY_ACTOR,
      ...(opts.pollIntervalMs !== undefined && {
        pollIntervalMs: opts.pollIntervalMs,
      }),
      ...(opts.roster && { roster: opts.roster }),
      createLocalProvider,
      appendReceived,
      ...(opts.onReceived && { onReceived: opts.onReceived }),
      ...(opts.onSynced && { onSynced: opts.onSynced }),
    }),
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return view;
}

/** tap は非同期に flush するので、記録後に少し待つ */
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

describe('useEventSyncTap (remote 配線 W3d5-5)', () => {
  describe('remoteQueue なし (未ログイン) = local-only', () => {
    it('編集はローカル正典にだけ流れる (W3d と同一挙動)', async () => {
      const local = new RecordingProvider();
      const { result } = await renderTap({ local });
      result.current.record(relabel());
      await settle();
      expect(local.pushed).toHaveLength(1);
    });
  });

  describe('remoteQueue あり (ログイン中) = fanout', () => {
    it('編集がローカル正典と remote の両方へ流れる', async () => {
      const local = new RecordingProvider();
      const remote = new RecordingProvider();
      const remoteQueue = new RemoteSyncQueue({
        provider: remote,
        did: MY_DID,
      });
      const { result } = await renderTap({ local, remoteQueue });

      result.current.record(relabel());
      await settle();

      expect(local.pushed).toHaveLength(1);
      expect(remote.pushed).toHaveLength(1);
      expect(remote.pushed[0].id).toBe(local.pushed[0].id); // 同じ batch が両系統へ
    });

    it('presentation はローカルに残り remote には載らない (D7)', async () => {
      const local = new RecordingProvider();
      const remote = new RecordingProvider();
      const remoteQueue = new RemoteSyncQueue({
        provider: remote,
        did: MY_DID,
      });
      const { result } = await renderTap({ local, remoteQueue });

      result.current.record(restyle());
      await settle();

      expect(local.pushed).toHaveLength(1); // ローカル正典には残す (W3e 保全)
      expect(remote.pushed).toHaveLength(0); // remote へは送らない
    });
  });

  describe('判断ログの clock を観測する (2026-09-05 実機で発覚)', () => {
    it('承認より後の編集が, 承認より後の clock を持つ', async () => {
      // 判断ログとグラフの op-log は clock 空間を共有する (Phase 1)。承認は判断ログの
      // 最大値 + 1 で発番されるので、tap がグラフ側からしか seed しないと
      // **参加した本人の最初の編集が「参加より前」に見え**、相手の期間フィルタが落とす
      const local = new RecordingProvider();
      local.existing = [batch('1')]; // グラフ側の最大 clock は 1
      const remote = new RecordingProvider();
      const remoteQueue = new RemoteSyncQueue({
        provider: remote,
        did: MY_DID,
      });

      const { result } = await renderTap({
        local,
        remoteQueue,
        roster: rosterWith(42), // 承認の clock が 42 だったとする
      });
      await settle();

      result.current.record(relabel());
      await settle();

      const written = local.pushed.at(-1);
      expect(written?.clock).toBeGreaterThan(42);
    });
  });

  describe('離脱中は他 actor の repo を読まない (2026-09-05 実機で発覚)', () => {
    const OTHER = 'did:plc:bob';

    it('参加者でなければ相手の repo を読みに行かない', async () => {
      // 期間フィルタは「書いた人がその時参加していたか」しか見ないので、
      // **読む側が離脱していても相手の編集は通ってしまう**。取り消されたのに
      // 相手の編集が届き続けるなら、取り消しを共有を切る操作として使えない
      const local = new RecordingProvider();
      const remote = new RecordingProvider();
      const remoteQueue = new RemoteSyncQueue({
        provider: remote,
        did: MY_DID,
      });
      const pulled: (string | undefined)[] = [];
      const spied = Object.assign(
        Object.create(Object.getPrototypeOf(remoteQueue)),
        remoteQueue,
      ) as typeof remoteQueue;
      spied.pullRemoteForFile = async (id, repo) => {
        pulled.push(repo);
        return remoteQueue.pullRemoteForFile(id, repo);
      };

      await renderTap({
        local,
        remoteQueue: spied,
        // 自分は名簿にいない = 取り消された後
        roster: rosterWith(1, [OTHER]),
      });
      await settle();

      // 自分の repo (repo=undefined) は読むが、相手の repo は読まない
      expect(pulled).toEqual([undefined]);
    });

    it('参加者なら相手の repo を読む', async () => {
      const local = new RecordingProvider();
      const remote = new RecordingProvider();
      const remoteQueue = new RemoteSyncQueue({
        provider: remote,
        did: MY_DID,
      });
      const pulled: (string | undefined)[] = [];
      const spied = Object.assign(
        Object.create(Object.getPrototypeOf(remoteQueue)),
        remoteQueue,
      ) as typeof remoteQueue;
      spied.pullRemoteForFile = async (id, repo) => {
        pulled.push(repo);
        return remoteQueue.pullRemoteForFile(id, repo);
      };

      await renderTap({
        local,
        remoteQueue: spied,
        roster: rosterWith(1, [MY_DID, OTHER]),
      });
      await settle();

      expect(pulled).toEqual([undefined, OTHER]);
    });
  });

  describe('定期ポーリング (step2 Phase 2 S4 / #202)', () => {
    /** 可視性を偽装する。既定 (jsdom/happy-dom) は常に可視である */
    const setHidden = (hidden: boolean) => {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => hidden,
      });
    };
    const setOnline = (online: boolean) => {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        get: () => online,
      });
    };
    /** 実時間で n ミリ秒待つ (ポーリングは実タイマーで回る) */
    const wait = (ms: number) =>
      act(async () => {
        await new Promise((r) => setTimeout(r, ms));
      });

    afterEach(() => {
      setHidden(false);
      setOnline(true);
    });

    it('間隔ごとに remote を読み直す (開き直さずに反映される)', async () => {
      const local = new RecordingProvider();
      const remote = new RecordingProvider();
      const remoteQueue = new RemoteSyncQueue({
        provider: remote,
        did: MY_DID,
      });
      await renderTap({ local, remoteQueue, pollIntervalMs: 10 });
      await settle();
      // 起動時の 1 回で取りこぼしは無い
      expect(receivedWrites).toHaveLength(0);

      // 他所 (別端末 / 別 actor) の編集が remote に現れる
      remote.existing = [batch('remote-1')];
      await wait(40);

      // **ファイルを開き直していないのに届く** — これが #202 の受入条件である
      expect(receivedWrites.map((w) => w.batches[0]?.id)).toContain('remote-1');
    });

    it('タブが不可視の間は読みに行かない', async () => {
      const local = new RecordingProvider();
      const remote = new RecordingProvider();
      const remoteQueue = new RemoteSyncQueue({
        provider: remote,
        did: MY_DID,
      });
      await renderTap({ local, remoteQueue, pollIntervalMs: 10 });
      await settle();

      setHidden(true);
      remote.existing = [batch('remote-1')];
      await wait(40);
      // 裏で開いたままのタブが参加者全員の repo を読み続けないこと
      expect(receivedWrites).toHaveLength(0);
    });

    it('可視に戻った瞬間に取りに行く (次の tick を待たない)', async () => {
      const local = new RecordingProvider();
      const remote = new RecordingProvider();
      const remoteQueue = new RemoteSyncQueue({
        provider: remote,
        did: MY_DID,
      });
      // 間隔を長くして「タイマーではなく visibilitychange が発火した」ことを確かめる
      await renderTap({ local, remoteQueue, pollIntervalMs: 60_000 });
      await settle();

      setHidden(true);
      remote.existing = [batch('remote-1')];
      setHidden(false);
      document.dispatchEvent(new Event('visibilitychange'));
      await settle();

      expect(receivedWrites.map((w) => w.batches[0]?.id)).toContain('remote-1');
    });

    it('オフラインの間は読みに行かない', async () => {
      const local = new RecordingProvider();
      const remote = new RecordingProvider();
      const remoteQueue = new RemoteSyncQueue({
        provider: remote,
        did: MY_DID,
      });
      await renderTap({ local, remoteQueue, pollIntervalMs: 10 });
      await settle();

      setOnline(false);
      remote.existing = [batch('remote-1')];
      await wait(40);
      expect(receivedWrites).toHaveLength(0);
    });

    it('unmount 後はタイマーが止まる', async () => {
      const local = new RecordingProvider();
      const remote = new RecordingProvider();
      const remoteQueue = new RemoteSyncQueue({
        provider: remote,
        did: MY_DID,
      });
      const { unmount } = await renderTap({
        local,
        remoteQueue,
        pollIntervalMs: 10,
      });
      await settle();
      unmount();

      remote.existing = [batch('remote-1')];
      await wait(40);
      expect(receivedWrites).toHaveLength(0);
    });
  });

  describe('再接続時 catch-up (§3.6 / W3d5-7)', () => {
    it('online イベントで取りこぼしを回収する', async () => {
      const local = new RecordingProvider();
      const remote = new RecordingProvider();
      remote.existing = []; // 起動時は remote 空 = 取りこぼし無し
      const remoteQueue = new RemoteSyncQueue({
        provider: remote,
        did: MY_DID,
      });

      await renderTap({ local, remoteQueue });
      await settle();
      expect(remote.pushed).toHaveLength(0);

      // オフライン中に積まれたローカル正典の batch を、復帰後に拾えること
      local.existing = [batch('1')];
      window.dispatchEvent(new Event('online'));
      await settle();

      expect(remote.pushed.map((b) => b.id)).toEqual(['1']);
    });

    it('unmount 後の online では catch-up しない (リスナ解除)', async () => {
      const local = new RecordingProvider();
      const remote = new RecordingProvider();
      const remoteQueue = new RemoteSyncQueue({
        provider: remote,
        did: MY_DID,
      });

      const { unmount } = await renderTap({ local, remoteQueue });
      unmount();

      local.existing = [batch('1')];
      window.dispatchEvent(new Event('online'));
      await settle();

      expect(remote.pushed).toHaveLength(0);
    });
  });

  describe('起動時 catch-up (§3.6)', () => {
    it('ローカル正典にあって remote に無い batch を mount 時に送る', async () => {
      const local = new RecordingProvider();
      local.existing = [batch('1'), batch('2')];
      const remote = new RecordingProvider();
      remote.existing = [batch('1')]; // '2' が取りこぼし
      const remoteQueue = new RemoteSyncQueue({
        provider: remote,
        did: MY_DID,
      });

      await renderTap({ local, remoteQueue });
      await settle();

      expect(remote.pushed.map((b) => b.id)).toEqual(['2']);
    });

    it('catch-up で genesis batch も remote へ送る (Phase 4e-0・C1 見直し)', async () => {
      const local = new RecordingProvider();
      local.existing = [batch('1', { actor: GENESIS_ACTOR }), batch('2')];
      const remote = new RecordingProvider();
      const remoteQueue = new RemoteSyncQueue({
        provider: remote,
        did: MY_DID,
      });

      await renderTap({ local, remoteQueue });
      await settle();

      expect(remote.pushed.map((b) => b.id)).toEqual(['1', '2']);
    });

    it('remoteQueue が無ければ catch-up は起きない (fanout でない)', async () => {
      const local = new RecordingProvider();
      local.existing = [batch('1')];
      await renderTap({ local });
      await settle();
      // local への push は catch-up 由来では発生しない (読取のみ)
      expect(local.pushed).toHaveLength(0);
    });
  });

  describe('受信の配線 (Phase 4d-5)', () => {
    it('mount 時に remote の batch をローカル正典へ取り込む', async () => {
      const local = new RecordingProvider();
      const remote = new RecordingProvider();
      remote.existing = [batch('r1'), batch('r2')];
      const remoteQueue = new RemoteSyncQueue({
        provider: remote,
        did: MY_DID,
      });

      await renderTap({ local, remoteQueue });
      await settle();

      // 受信が実際に発火し、正典宣言つきの書き込み口へ届いていること
      expect(receivedWrites).toHaveLength(1);
      expect(receivedWrites[0]?.fileId).toBe(FID);
      expect(receivedWrites[0]?.batches.map((b) => b.id)).toEqual(['r1', 'r2']);
    });

    it('受信は fanout を通さない — remote へ送り返さない (echo ループ回避, §3.3a)', async () => {
      const local = new RecordingProvider();
      const remote = new RecordingProvider();
      remote.existing = [batch('r1')];
      const remoteQueue = new RemoteSyncQueue({
        provider: remote,
        did: MY_DID,
      });

      await renderTap({ local, remoteQueue });
      await settle();

      // 受信した 'r1' が remote へ push され直していないこと。
      // (catch-up は local.existing が空なので何も送らない)
      expect(remote.pushed.map((b) => b.id)).not.toContain('r1');
    });

    it('online イベントでも受信する (送信 catch-up と同じ契機, §3.4)', async () => {
      const local = new RecordingProvider();
      const remote = new RecordingProvider();
      const remoteQueue = new RemoteSyncQueue({
        provider: remote,
        did: MY_DID,
      });

      await renderTap({ local, remoteQueue });
      await settle();
      const afterMount = receivedWrites.length;

      remote.existing = [batch('r9')];
      window.dispatchEvent(new Event('online'));
      await settle();

      expect(receivedWrites.length).toBe(afterMount + 1);
      expect(receivedWrites.at(-1)?.batches.map((b) => b.id)).toEqual(['r9']);
    });

    it('受信が失敗しても送信 catch-up は動く (両者は独立)', async () => {
      const local = new RecordingProvider();
      local.existing = [batch('1')];
      const remote = new RecordingProvider();
      remote.existing = [batch('r1')];
      const remoteQueue = new RemoteSyncQueue({
        provider: remote,
        did: MY_DID,
      });
      receiveFails = new Error('daemon down');

      await renderTap({ local, remoteQueue });
      await settle();

      // 受信は失敗したが、ローカルにあって remote に無い '1' は送られている
      expect(remote.pushed.map((b) => b.id)).toContain('1');
      expect(receivedWrites).toHaveLength(0);
    });

    it('remoteQueue が無ければ受信も起きない (未ログイン時は local-only)', async () => {
      const local = new RecordingProvider();
      await renderTap({ local });
      await settle();
      expect(receivedWrites).toHaveLength(0);
    });
  });

  describe('画面反映の起点 onReceived (Phase 4e-3)', () => {
    it('受信が着地したら fileId・結果・待ち合わせ点つきで呼ばれる', async () => {
      const local = new RecordingProvider();
      const remote = new RecordingProvider();
      remote.existing = [batch('r1'), batch('r2')];
      const remoteQueue = new RemoteSyncQueue({
        provider: remote,
        did: MY_DID,
      });
      const calls: Array<{
        fileId: FileId;
        appended: number;
        pending: number;
      }> = [];

      await renderTap({
        local,
        remoteQueue,
        onReceived: async (fileId, result, tap) => {
          await tap.settled(); // 待ち合わせ点がそのまま使える
          calls.push({
            fileId,
            appended: result.appended,
            pending: tap.pending(),
          });
        },
      });
      await settle();

      expect(calls).toEqual([{ fileId: FID, appended: 2, pending: 0 }]);
    });

    it('新規着地が無ければ呼ばれない (再 projection しても画面は変わらない)', async () => {
      const local = new RecordingProvider();
      const remote = new RecordingProvider(); // remote は空 = 受信 0 件
      const remoteQueue = new RemoteSyncQueue({
        provider: remote,
        did: MY_DID,
      });
      let called = 0;

      await renderTap({
        local,
        remoteQueue,
        onReceived: () => {
          called += 1;
        },
      });
      await settle();

      expect(called).toBe(0);
    });
  });

  describe('同期義務の解除 onSynced (step2 Phase 2 S6)', () => {
    it('⚠️ 着地が 1 件も無くても呼ばれる', () => {
      // **ここが `onReceived` と違うところである。**あれは着地したときだけ鳴るので、
      // 義務の解除に使うと**追いつくものが無い File が永久に読み取り専用**になる
      const local = new RecordingProvider();
      const remote = new RecordingProvider(); // remote は空 = 受信 0 件
      const remoteQueue = new RemoteSyncQueue({
        provider: remote,
        did: MY_DID,
      });
      const received: FileId[] = [];
      const synced: FileId[] = [];

      return renderTap({
        local,
        remoteQueue,
        onReceived: (fileId) => {
          received.push(fileId);
        },
        onSynced: (fileId) => {
          synced.push(fileId);
        },
      })
        .then(settle)
        .then(() => {
          expect(received).toEqual([]);
          expect(synced).toEqual([FID]);
        });
    });

    it('着地したときにも呼ばれる', async () => {
      const local = new RecordingProvider();
      const remote = new RecordingProvider();
      remote.existing = [batch('r1')];
      const remoteQueue = new RemoteSyncQueue({
        provider: remote,
        did: MY_DID,
      });
      const synced: FileId[] = [];

      await renderTap({
        local,
        remoteQueue,
        onSynced: (fileId) => {
          synced.push(fileId);
        },
      });
      await settle();

      expect(synced).toEqual([FID]);
    });

    it('⚠️ 受信が失敗したサイクルでは呼ばれない', () => {
      // 同期していないのに義務を解いてはならない。解くと、取りこぼしたまま
      // 書けるようになる
      const local = new RecordingProvider();
      const remote = new RecordingProvider();
      remote.existing = [batch('r1')]; // 受け取るものがあって, 書き込みで落ちる
      const remoteQueue = new RemoteSyncQueue({
        provider: remote,
        did: MY_DID,
      });
      receiveFails = new Error('PDS が応答しない');
      const synced: FileId[] = [];

      return renderTap({
        local,
        remoteQueue,
        onSynced: (fileId) => {
          synced.push(fileId);
        },
      })
        .then(settle)
        .then(() => {
          expect(synced).toEqual([]);
        });
    });
  });

  describe('ファイル未オープン', () => {
    it('fileId が null なら record は no-op で provider を作らない', async () => {
      const local = new RecordingProvider();
      const remote = new RecordingProvider();
      const remoteQueue = new RemoteSyncQueue({
        provider: remote,
        did: MY_DID,
      });
      const { result } = await renderTap({ local, remoteQueue, fileId: null });

      result.current.record(relabel());
      await settle();

      expect(local.pushed).toHaveLength(0);
      expect(remote.pushed).toHaveLength(0);
    });
  });
});
