/**
 * 常駐の agent の loop (agent 段 5、設計 D12・D13・A2'、汎用にしたのは計画 node-actions-request-module.md B4)
 *
 * ログインを保ち (S1)、参加している File を同期し続け (S2)、同期し終えるたびに module の常駐の振る舞い
 * (`ResidentWorker`) に知らせる。何をするか (依頼を見つけて言語モデルを起動する、など) は module が決め、
 * ここは知らない。**conversensus は依頼を評価しない** — 起動された言語モデルが MCP の道具で書く。
 */

import type { LiveChannel } from '@conversensus/client/src/sync/liveChannel';
import type { FileId } from '@conversensus/shared';
import type { Headless } from '../headless';
import type { ResidentWorker } from '../headlessModule';
import { watch } from './watch';

/** 流れに繋がっていないときのポーリングの間隔の既定 */
export const DEFAULT_POLL_INTERVAL_MS = 60_000;
/** 流れに繋がっている間のポーリングの間隔の既定 (合図が抜けたときの保険) */
export const DEFAULT_LIVE_POLL_INTERVAL_MS = 10 * 60_000;

export type ResidentOptions = {
  headless: Headless;
  handle: string;
  appPassword: string;
  /** 同期し終えるたびに知らせる相手 (module の常駐の振る舞い) */
  workers: readonly ResidentWorker[];
  /** 流れの合図。無ければポーリングだけ */
  live: LiveChannel | null;
  pollIntervalMs?: number;
  livePollIntervalMs?: number;
  log?: (message: string) => void;
};

export type Resident = {
  /** 今ある契機と仕事を回し終えるまで待つ (試験用) */
  idle: () => Promise<void>;
  stop: () => void;
};

/**
 * 常駐を始める。ログインを確かめ (戻せなければ app password で入る)、同期し続け、同期し終えるたびに
 * workers に知らせる。呼ぶ側は `Headless` を開いておく (閉じるのも呼ぶ側)
 */
export async function startResident(
  options: ResidentOptions,
): Promise<Resident> {
  const { headless, handle, appPassword, workers } = options;
  const log = options.log ?? ((m) => console.error(`[resident] ${m}`));
  await headless.ensureSignedIn(handle, appPassword);
  log(`${headless.did} (${headless.actor}) として常駐する`);

  const stopLive = options.live?.start();
  const watcher = watch({
    files: async () => (await headless.files()).map((f) => f.id as FileId),
    // 見つけ直しはポーリングのたびに走る。そのたびにログインを確かめる (失効していれば入り直す)
    discover: async () => {
      if (await headless.ensureSignedIn(handle, appPassword)) {
        log('セッションが失効していたので、ログインし直した');
      }
      await headless.discover();
    },
    sync: (fileId) => headless.sync(fileId),
    live: options.live,
    pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    livePollIntervalMs:
      options.livePollIntervalMs ?? DEFAULT_LIVE_POLL_INTERVAL_MS,
    onSynced: (fileId) => {
      for (const w of workers) w.offer(fileId);
    },
    onError: (error) => log(`同期: ${error}`),
  });

  return {
    idle: async () => {
      await watcher.idle();
      await Promise.all(workers.map((w) => w.idle()));
    },
    stop: () => {
      watcher.stop();
      stopLive?.();
    },
  };
}
