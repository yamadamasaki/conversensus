/**
 * 依頼の module の常駐の振る舞い (agent 段 5 S3・S5、計画 node-actions-request-module.md B4)
 *
 * 常駐の agent が File を同期し終えるたびに、自分宛てに送られた依頼を見つけ (`requestsForMe`)、まだ起動して
 * いなければ言語モデルを 1 依頼に 1 回起動する (`requestDispatch.ts`)。言語モデルへの頼み方 (prompt) も
 * ここが決める — 「read_file で読み、answer_request で答える」。起動そのもの (`claude -p`) は headless の
 * 汎用の口 (`AgentRunner`) である。
 */

import type { Headless } from '@conversensus/headless/src/headless';
import type {
  ResidentContext,
  ResidentWorker,
} from '@conversensus/headless/src/headlessModule';
import type { FileId, NodeId, SheetId } from '@conversensus/shared';
import {
  createDispatcher,
  type JobRunner,
  type RequestJob,
  storageAttempts,
} from './requestDispatch';
import { requestsForMe } from './requestHeadless';
import { sentCountOf } from './requestNode';

/** 依頼 1 つへの prompt */
export function promptFor(job: RequestJob): string {
  return [
    'あなたは conversensus という共同編集のグラフに参加している agent です。',
    'あなた宛てに依頼が送られてきました。conversensus の MCP の道具だけを使って答えてください。',
    '',
    `- File: ${job.fileId}`,
    `- Sheet: ${job.sheetId}`,
    `- 依頼の node: ${job.nodeId} (${job.sent} 回目の送信)`,
    '',
    '依頼の本文 (正は File の中です):',
    '```',
    job.content,
    '```',
    '',
    '手順:',
    '1. read_file でこの File を読み、依頼の前後の文脈と、依頼の種類の説明 (種類ごとの指示) を確かめる',
    '2. answer_request で答えを書く (答えは新しい node になり、依頼から edge が張られる)',
    '3. 答えられないときは、答えられない理由を答えとして書く',
  ].join('\n');
}

/** 依頼の一覧の 1 行を、起動する依頼にする */
function jobsOf(headless: Headless, fileId: FileId): RequestJob[] {
  return requestsForMe(headless, fileId).map((r) => ({
    fileId,
    sheetId: r.sheet.id as SheetId,
    nodeId: r.node.id as NodeId,
    sent: sentCountOf(r.node),
    content: r.node.content,
  }));
}

/**
 * 依頼に答える常駐の振る舞い。起動した印は置き場所の `localStorage` (headless では `storage.json`) に残す
 * (再起動しても同じ送信に 2 度起動しない)。試験は `runner` に依頼を直接受ける偽物を渡す
 */
export function createRequestWorker(options: {
  headless: Headless;
  runner: JobRunner;
  log: (message: string) => void;
}): ResidentWorker {
  const { headless, log } = options;
  return createDispatcher({
    requestsOf: (fileId) => jobsOf(headless, fileId),
    runner: {
      run: async (job) => {
        log(`依頼に答える: ${job.fileId} ${job.nodeId} (${job.sent} 回目)`);
        await options.runner.run(job);
      },
    },
    attempts: storageAttempts(localStorage),
    onError: (job, error) => log(`答えられなかった: ${job.nodeId}: ${error}`),
  });
}

/** 常駐の入口に渡す形: 汎用の起動の口に、依頼ごとの prompt を渡す */
export function requestResident(ctx: ResidentContext): ResidentWorker {
  return createRequestWorker({
    headless: ctx.headless,
    log: ctx.log,
    runner: {
      run: (job) =>
        ctx.runner.run({
          label: `${job.nodeId} (${job.sent} 回目)`,
          prompt: promptFor(job),
        }),
    },
  });
}
