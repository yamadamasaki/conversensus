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
 */

import type { FileId, NodeId, SheetId } from '@conversensus/shared';

/** 起動する依頼 1 つ */
export type RequestJob = {
  fileId: FileId;
  sheetId: SheetId;
  nodeId: NodeId;
  /** 何回目の送信か */
  sent: number;
  content: string;
};

/** 言語モデルを起動する口 (既定は `claude -p`、S5。試験では偽物) */
export interface AgentRunner {
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
  runner: AgentRunner;
  attempts: AttemptStore;
  onError?: (job: RequestJob, error: unknown) => void;
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
      deps.attempts.record(job.fileId, job.nodeId, job.sent);
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
        if (due(job) && !queued.has(keyOf(job))) queue.push(job);
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

/** 印を `Storage` に置く。値は `{ "<fileId>/<nodeId>": 回数 }` の JSON */
export function storageAttempts(storage: Storage): AttemptStore {
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
      all[`${fileId}/${nodeId}`] = sent;
      storage.setItem(ATTEMPTS_STORAGE_KEY, JSON.stringify(all));
    },
  };
}
