/**
 * 参加している File を同期し続ける (agent 段 5 S2、設計 D11)
 *
 * ブラウザの `FileSession.start` は `document`・`window` (画面が見えているか・回線があるか) を読むので、
 * headless では使えない。ここは**同期の契機だけ**を持ち、同期そのものは `Headless.sync` (= `FileSession.syncNow`)
 * に任せる。受信の経路はブラウザと同じ 1 本である。
 *
 * 契機は 3 つ:
 *
 * 1. 始めたとき: 参加している File を見つけ (`discover`)、全部を同期する
 * 2. **流れの合図** (`LiveSignal`、#252): その File を同期する。**知らない File の合図**は、新しく参加した
 *    File かもしれないので見つけ直す。`null` (繋がった・切れた — 取りこぼしたかもしれない) は全部
 * 3. **遅いポーリング**: 合図が抜けても拾う。流れに繋がっている間は間隔を延ばす
 *
 * **同期は 1 本ずつ回し、溜まった契機はまとめる** — 合図が続けて来ても、同じ File の同期を積み上げない。
 * 同期の後に `onSynced` を呼ぶ (依頼を見つける側、S3)。
 */

import type { LiveSignal } from '@conversensus/client/src/sync/liveChannel';
import type { FileId } from '@conversensus/shared';

export type WatchDeps = {
  /** 手元にある File (参加しているもの・自分で作ったもの) */
  files: () => Promise<FileId[]>;
  /** 手元に無い参加している File を見つけて取り込む */
  discover: () => Promise<void>;
  sync: (fileId: FileId) => Promise<void>;
  /** 流れの合図。無ければポーリングだけ */
  live: LiveSignal | null;
  /** 流れに繋がっていないときのポーリングの間隔 (ミリ秒) */
  pollIntervalMs: number;
  /** 流れに繋がっている間のポーリングの間隔 (ミリ秒) */
  livePollIntervalMs: number;
  /** File を同期し終えた (失敗しても呼ぶ — 手元の正典は読める) */
  onSynced: (fileId: FileId) => void | Promise<void>;
  onError?: (error: unknown) => void;
};

/** 溜まった契機。`all` は全部の File、`discover` は見つけ直す */
type Pending = { all: boolean; discover: boolean; files: Set<FileId> };

/** 同期し続ける。止める関数と、今溜まっている契機を回し終えるのを待つ口を返す */
export function watch(deps: WatchDeps): {
  stop: () => void;
  idle: () => Promise<void>;
} {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | null = null;
  const pending: Pending = { all: true, discover: true, files: new Set() };
  const report = (error: unknown) =>
    (deps.onError ?? ((e) => console.warn('[resident] 同期:', e)))(error);

  const runOnce = async () => {
    const { all, discover } = pending;
    const asked = [...pending.files];
    pending.all = false;
    pending.discover = false;
    pending.files.clear();
    let known = await deps.files();
    // 知らない File の合図は、新しく参加した File かもしれない
    if (discover || asked.some((id) => !known.includes(id))) {
      await deps.discover().catch(report);
      known = await deps.files();
    }
    const targets = all ? known : asked.filter((id) => known.includes(id));
    for (const fileId of targets) {
      if (stopped) return;
      await deps.sync(fileId).catch(report);
      await Promise.resolve(deps.onSynced(fileId)).catch(report);
    }
  };

  /** 溜まった契機が無くなるまで 1 本で回す */
  const kick = (): Promise<void> => {
    running ??= (async () => {
      while (
        !stopped &&
        (pending.all || pending.discover || pending.files.size > 0)
      ) {
        await runOnce().catch(report);
      }
    })().finally(() => {
      running = null;
    });
    return running;
  };

  const interval = () =>
    deps.live?.isConnected() ? deps.livePollIntervalMs : deps.pollIntervalMs;
  const schedule = () => {
    clearTimeout(timer);
    if (stopped) return;
    timer = setTimeout(() => {
      pending.all = true;
      pending.discover = true;
      void kick().then(schedule);
    }, interval());
  };

  const unsubscribe = deps.live?.onHint(({ fileId }) => {
    if (fileId === null) {
      pending.all = true;
      schedule(); // 繋がり方が変わったので間隔を決め直す
    } else {
      pending.files.add(fileId);
    }
    void kick();
  });

  void kick().then(schedule);

  return {
    stop: () => {
      stopped = true;
      clearTimeout(timer);
      unsubscribe?.();
    },
    idle: async () => {
      while (running) await running;
    },
  };
}
