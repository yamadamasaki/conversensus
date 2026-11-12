/**
 * 自分宛ての依頼を見つけて、言語モデルを起動する (agent 段 5 S3、設計 D12・D13)
 *
 * conversensus は依頼を評価しない (D12)。ここは**見つけて起動するだけ**で、答えを書くのは起動された
 * 言語モデル (MCP の道具を通して) である。何を見つけるかは `Headless.requestsForMe` の規則
 * (送った・未回答・自分宛て・自分が送ったものでない) に従う。
 *
 * ## 同じ送信には 1 度しか起動しない
 *
 * 依頼は (File・node・**送った回数**) で数える。送り直されれば (回数が増えれば) 新しい依頼として起動する。
 *
 * - **起動する前に印を置く** — 起動の途中でプロセスが落ちても、再起動して同じ送信に 2 度答えない。
 *   答えられなかった依頼は「送った・未回答」のまま残るので、依頼した人が見て送り直せる
 * - 印は置き場所に残す (再起動をまたぐ)。node ごとに**起動した最後の回数**だけを持つ (送った回数は増えるだけ)
 *
 * ## 1 つずつ
 *
 * 言語モデルの起動は重く、同じ File に同時に 2 つ書くと答えの置き場所 (`answerPlacement`) が重なる。
 * 列に入れて 1 つずつ起動する。**起動する直前にもう一度確かめる** — 列で待っている間に誰かが答えた・
 * 閉じた依頼は起動しない。
 *
 * ## 起動の回数に上限を置く (#387)
 *
 * 起動は operator の費用と CPU を使う。依頼の数や送り直しの回数に比例させない (`DispatchLimits`)。
 *
 * - **列の長さ**: 溢れた依頼は列に入れない。次の同期で、まだ開いていれば入り直す
 * - **1 時間あたり (全体・送り手ごと)**: 超えた依頼は印を置かずに見送る。次の同期で、時間が空いていれば起動する
 * - **同じ node への回数**: 送り直しが上限を超えたら、印を置いて起動しない (送り直しても答えない)
 */

import type { Did, FileId, NodeId, SheetId } from '@conversensus/shared';

/** 起動する依頼 1 つ */
export type RequestJob = {
  fileId: FileId;
  sheetId: SheetId;
  nodeId: NodeId;
  /** 何回目の送信か */
  sent: number;
  content: string;
  /** 送った人 (分かれば)。送り手ごとの上限に使う */
  from?: Did;
};

/** 起動の回数の上限 (#387) */
export type DispatchLimits = {
  /** 列に入れておく依頼の数 */
  queue: number;
  /** 同じ依頼の node に起動する回数 (送り直しを含む) */
  perNode: number;
  /** 全体で 1 時間に起動する回数 */
  perHour: number;
  /** 送り手 1 人から 1 時間に起動する回数 */
  perSenderPerHour: number;
};

export const DEFAULT_DISPATCH_LIMITS: DispatchLimits = {
  queue: 20,
  perNode: 5,
  perHour: 30,
  perSenderPerHour: 10,
};

/** 上限の時間の幅 */
const HOUR_MS = 60 * 60_000;

/** 起動しなかった理由 (log に出す) */
export type SkipReason = 'queueFull' | 'perNode' | 'perHour' | 'perSender';

/**
 * 依頼 1 つに言語モデルを起動する口。常駐の入口では headless の汎用の起動 (`claude -p`) に prompt を渡す
 * (`requestResident.ts`)。試験では偽物
 */
export interface JobRunner {
  run(job: RequestJob): Promise<void>;
}

/** node ごとの「起動した最後の送った回数」を置く所 */
export interface AttemptStore {
  lastAttempted(fileId: FileId, nodeId: NodeId): number;
  record(fileId: FileId, nodeId: NodeId, sent: number): void;
}

export type DispatcherDeps = {
  /** その File の、今答えるべき依頼 (手元の正典から) */
  requestsOf: (fileId: FileId) => RequestJob[];
  runner: JobRunner;
  attempts: AttemptStore;
  onError?: (job: RequestJob, error: unknown) => void;
  /** 上限 (#387)。既定 `DEFAULT_DISPATCH_LIMITS` */
  limits?: DispatchLimits;
  /** 上限で起動しなかった (log に出す) */
  onSkip?: (job: RequestJob, reason: SkipReason) => void;
  /** 今の時刻 (試験で差し替える) */
  now?: () => number;
};

const keyOf = (job: { fileId: FileId; nodeId: NodeId; sent: number }) =>
  `${job.fileId}/${job.nodeId}/${job.sent}`;

export function createDispatcher(deps: DispatcherDeps): {
  /** File を同期し終えたときに呼ぶ。まだ起動していない依頼を列に入れる */
  offer: (fileId: FileId) => void;
  /** 列が空になるまで待つ */
  idle: () => Promise<void>;
} {
  const queue: RequestJob[] = [];
  let running: Promise<void> | null = null;
  const limits = deps.limits ?? DEFAULT_DISPATCH_LIMITS;
  const now = deps.now ?? Date.now;
  const skip = deps.onSkip ?? (() => {});
  /** 起動した時刻と送り手 (1 時間より前のものは捨てる) */
  let launched: { at: number; from?: Did }[] = [];

  /** 1 時間あたりの上限に当たるなら、その理由 */
  const overRate = (job: RequestJob): SkipReason | undefined => {
    const since = now() - HOUR_MS;
    launched = launched.filter((l) => l.at > since);
    if (launched.length >= limits.perHour) return 'perHour';
    if (
      job.from !== undefined &&
      launched.filter((l) => l.from === job.from).length >=
        limits.perSenderPerHour
    ) {
      return 'perSender';
    }
    return undefined;
  };

  const due = (job: RequestJob) =>
    deps.attempts.lastAttempted(job.fileId, job.nodeId) < job.sent;

  /** 起動する直前に、まだ答えるべきか確かめる */
  const stillOpen = (job: RequestJob) =>
    deps
      .requestsOf(job.fileId)
      .some((r) => r.nodeId === job.nodeId && r.sent === job.sent);

  const drain = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      if (!due(job) || !stillOpen(job)) continue;
      if (job.sent > limits.perNode) {
        // 送り直しても答えない。印を置き、同期のたびに見送りを繰り返さない
        deps.attempts.record(job.fileId, job.nodeId, job.sent);
        skip(job, 'perNode');
        continue;
      }
      const rate = overRate(job);
      if (rate) {
        // 印は置かない。次の同期で、まだ開いていて時間が空いていれば起動する
        skip(job, rate);
        continue;
      }
      deps.attempts.record(job.fileId, job.nodeId, job.sent);
      launched.push({ at: now(), ...(job.from && { from: job.from }) });
      try {
        await deps.runner.run(job);
      } catch (error) {
        (deps.onError ?? ((j, e) => console.warn('[resident] 起動:', j, e)))(
          job,
          error,
        );
      }
    }
  };

  /** 列を回す。回し終えた後に入ったものがあれば、もう一度回す (取り残さない) */
  const kick = () => {
    running ??= drain().finally(() => {
      running = null;
      if (queue.length > 0) kick();
    });
  };

  return {
    offer: (fileId) => {
      const queued = new Set(queue.map(keyOf));
      for (const job of deps.requestsOf(fileId)) {
        if (!due(job) || queued.has(keyOf(job))) continue;
        if (queue.length >= limits.queue) {
          // 溢れた分は次の同期で入り直す
          skip(job, 'queueFull');
          continue;
        }
        queue.push(job);
        queued.add(keyOf(job));
      }
      kick();
    },
    idle: async () => {
      while (running) await running;
    },
  };
}

/** 置き場所の `localStorage` (headless では `FileStorage`) のキー */
export const ATTEMPTS_STORAGE_KEY = 'conversensus.resident.attempts';

/**
 * 印の数の上限の既定 (#387)。依頼の数だけ増え続けないように、古い (最後に置いたのが前の) 印から捨てる。
 * 捨てた印の依頼がまだ「送った・未回答」なら、もう一度起動しうる — 上限は、それが起きないほど大きく取る
 */
export const DEFAULT_MAX_ATTEMPT_RECORDS = 1000;

/** 印を `Storage` に置く。値は `{ "<fileId>/<nodeId>": 回数 }` の JSON (置いた順) */
export function storageAttempts(
  storage: Storage,
  maxRecords = DEFAULT_MAX_ATTEMPT_RECORDS,
): AttemptStore {
  const read = (): Record<string, number> => {
    try {
      const parsed: unknown = JSON.parse(
        storage.getItem(ATTEMPTS_STORAGE_KEY) ?? '{}',
      );
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, number>)
        : {};
    } catch {
      return {};
    }
  };
  return {
    lastAttempted: (fileId, nodeId) => {
      const value = read()[`${fileId}/${nodeId}`];
      return typeof value === 'number' ? value : 0;
    },
    record: (fileId, nodeId, sent) => {
      const all = read();
      const key = `${fileId}/${nodeId}`;
      // 置き直したものを末尾へ (古いものから捨てるため)。キーは数字でないので、置いた順に並ぶ
      delete all[key];
      all[key] = sent;
      const keys = Object.keys(all);
      for (const old of keys.slice(0, Math.max(0, keys.length - maxRecords))) {
        delete all[old];
      }
      storage.setItem(ATTEMPTS_STORAGE_KEY, JSON.stringify(all));
    },
  };
}
