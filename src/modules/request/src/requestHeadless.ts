/**
 * 依頼の module の headless の側 (計画 node-actions-request-module.md B3、agent 段 4 R6)
 *
 * MCP の依頼の道具 (`list_requests`・`answer_request`・`send_request`・`close_request`・`reopen_request`・
 * `set_addressee`)、`read_file` の注釈 (依頼の状態と宛先)、自分宛ての未回答の依頼 (`requestsForMe`) を出す。
 * headless の library は依頼を知らず、入口 (`src/headless/src/mcp.ts`・常駐) がこの module を渡す。
 */

import type { Headless } from '@conversensus/headless/src/headless';
import type { HeadlessModule } from '@conversensus/headless/src/headlessModule';
import { type ToolContext, ToolError } from '@conversensus/headless/src/tools';
import {
  type Did,
  type FileId,
  type GraphEdge,
  type GraphNode,
  projectFile,
} from '@conversensus/shared';
import { z } from 'zod';
import { senderOf } from './requestArrival';
import {
  answerRequest,
  closeRequest,
  reopenRequest,
  sendRequest,
  setAddressee,
} from './requestEvents';
import {
  addresseeOf,
  isAddressedTo,
  type RequestEntry,
  type RequestStatus,
  requestStatus,
  requestsInFile,
  sentCountOf,
} from './requestNode';
import { requestResident } from './requestResident';

/**
 * 自分宛ての未回答の依頼。**自分が送ったものは除く** — 宛先が不特定なら自分も宛先に入るが、自分の依頼に
 * 自分で答えることはない。手元の正典から読む (最新にするなら先に `sync`)
 */
export function requestsForMe(
  headless: Headless,
  fileId: FileId,
): (RequestEntry & { from: Did | undefined })[] {
  // ログインしていなければ `did` が理由つきで投げる
  const me = headless.did;
  const batches = headless.batches(fileId);
  return requestsInFile(projectFile([...batches], fileId)).flatMap((r) => {
    const from = senderOf(batches, r.node.id);
    return r.status === 'sent' && isAddressedTo(r.node, me) && from !== me
      ? [{ ...r, from }]
      : [];
  });
}

/** 応答を求める node の状態の名前 (注釈用) */
const REQUEST_STATUS_NOTE: Record<RequestStatus, string> = {
  draft: '下書き (まだ送っていない)',
  sent: '送った・未回答',
  answered: '回答あり',
  closed: '閉じた',
};

/**
 * 応答を求める node なら、状態と宛先の注釈。状態は導出なので注釈に置く — 情報は property の行
 * (`sent`・`closed`・`addressee`) と答えの edge にある
 */
export function requestNote(
  node: GraphNode,
  edges: readonly GraphEdge[],
): string[] {
  const addressee = addresseeOf(node);
  if (addressee === undefined) return [];
  const sent = sentCountOf(node);
  const status = REQUEST_STATUS_NOTE[requestStatus(node, edges)];
  const to =
    addressee.length === 0 ? '指定なし (参加者全員)' : addressee.join(', ');
  return [
    `応答を求める node: ${status}${sent > 0 ? ` (${sent} 回目)` : ''}・宛先 ${to}`,
  ];
}

/** agent への説明 (MCP の `instructions` に足す) */
const INSTRUCTIONS = `- **依頼・相談** (応答を求める node): list_requests で自分宛ての未回答の依頼を見つけ、read_file で依頼のある File を読んで文脈をつかみ、answer_request で答えます。依頼の本文が指示です。種類ごとの指示は種類の説明 (\`# template\` の注釈) にあります。答えられないときは、その理由を答えとして書いてください
- 自分から依頼することもできます: 依頼の種類で add_node し、set_addressee で宛先 (list_participants の DID) を選び、send_request で送ります`;

/** 書く先の Sheet の node */
function requestIn(ctx: ToolContext, nodeId: string): GraphNode {
  const node = ctx.sheet.nodes.find((n) => n.id === nodeId);
  if (!node) throw new ToolError(`この Sheet に node ${nodeId} は無い`);
  return node;
}

export const REQUEST_HEADLESS_MODULE: HeadlessModule = {
  id: 'request',
  instructions: INSTRUCTIONS,
  annotateNode: requestNote,
  // 常駐の agent: 送られた依頼に言語モデルを起動する (段 5)。requestResident.ts とは互いに import するので、呼ぶときに引く
  resident: (ctx) => requestResident(ctx),
  registerTools: ({ server, headless, write, guarded, fileIdOf, where }) => {
    const target = {
      ...where,
      nodeId: z.string().uuid().describe('依頼の node の id'),
    };

    server.registerTool(
      'list_requests',
      {
        description:
          '自分宛ての未回答の依頼を返す (同期してから)。fileId を省くと、参加している File すべてを見る。自分が送った依頼は出さない',
        inputSchema: { fileId: where.fileId.optional() },
      },
      ({ fileId }) =>
        guarded(async () => {
          let ids: FileId[];
          if (fileId) {
            ids = [fileIdOf(fileId)];
          } else {
            await headless.discover();
            ids = (await headless.files()).map((f) => f.id as FileId);
          }
          const lines: string[] = [];
          for (const id of ids) {
            await headless.sync(id);
            for (const r of requestsForMe(headless, id)) {
              lines.push(
                `request ${r.node.id} file ${id} sheet ${r.sheet.id} (${sentCountOf(r.node)} 回目) from ${r.from ?? '?'}`,
                `  content ${JSON.stringify(r.node.content)}`,
              );
            }
          }
          return lines.length > 0
            ? lines.join('\n')
            : '(自分宛ての未回答の依頼は無い)';
        }),
    );

    server.registerTool(
      'answer_request',
      {
        description:
          '依頼に答える: 答えを新しい node に書き、依頼からその node へ edge を張る (edge に何回目の送信への答えかが付く)。答えの node の id を返す',
        inputSchema: {
          ...target,
          content: z.string().describe('答えの本文 (markdown)'),
          label: z
            .string()
            .optional()
            .describe('答えの edge の label (省略可)'),
        },
      },
      ({ fileId, sheetId, nodeId, content, label }) =>
        write({ fileId, sheetId }, (ctx) => {
          const answered = answerRequest(ctx.sheet, requestIn(ctx, nodeId), {
            content,
            ...(label !== undefined && { edgeLabel: label }),
          });
          return {
            event: answered.event,
            report: `答えた: node ${answered.nodeId} (edge ${answered.edgeId})`,
          };
        }),
    );

    server.registerTool(
      'send_request',
      {
        description:
          '依頼を送る (送り直す)。宛先 (空なら参加者全員) に知らせが届く。閉じた依頼は送れない',
        inputSchema: target,
      },
      ({ fileId, sheetId, nodeId }) =>
        write({ fileId, sheetId }, (ctx) => ({
          event: sendRequest(requestIn(ctx, nodeId)),
          report: `node ${nodeId} を送った`,
        })),
    );

    server.registerTool(
      'close_request',
      { description: '依頼を閉じる', inputSchema: target },
      ({ fileId, sheetId, nodeId }) =>
        write({ fileId, sheetId }, (ctx) => ({
          event: closeRequest(requestIn(ctx, nodeId)),
          report: `node ${nodeId} を閉じた`,
        })),
    );

    server.registerTool(
      'reopen_request',
      { description: '閉じた依頼を開き直す', inputSchema: target },
      ({ fileId, sheetId, nodeId }) =>
        write({ fileId, sheetId }, (ctx) => ({
          event: reopenRequest(requestIn(ctx, nodeId)),
          report: `node ${nodeId} を開き直した`,
        })),
    );

    server.registerTool(
      'set_addressee',
      {
        description:
          '依頼の宛先を置き換える (DID の列。空なら不特定 = 参加者全員)。DID は list_participants で引く',
        inputSchema: { ...target, dids: z.array(z.string()) },
      },
      ({ fileId, sheetId, nodeId, dids }) =>
        write({ fileId, sheetId }, (ctx) => ({
          event: setAddressee(requestIn(ctx, nodeId), dids as Did[]),
          report: `node ${nodeId} の宛先を変えた`,
        })),
    );
  },
};
