/**
 * 依頼の module (計画 node-actions-request-module.md N3、設計 agent-actor.md D6・D7・D8・D12)
 *
 * 「応答を求める node」への操作と、その状態の印を、core の node の操作の拡張点に登録する。
 * core は依頼を知らない — ここが返す宣言と純粋な関数を、core が node のそば・右クリックのメニュー・
 * dialog・印として描く。op にするのは `requestEvents.ts` である。
 *
 * | 操作 | 出る状態 | 引数 (dialog) |
 * | --- | --- | --- |
 * | 送る | 下書き | 宛先・答えの置き場所 |
 * | 送り直す | 送った・回答あり | 同上 (今の値が入っている) |
 * | 答える | 送った・回答あり | 答えの本文 |
 * | 閉じる | 送った・回答あり | なし |
 * | 開き直す | 閉じた | なし |
 *
 * 「送る」「送り直す」は undo で戻せない (相手に届く行為。やめるなら「閉じる」)。
 *
 * 宛先だけを変える操作は持たない (計画 §3.1)。宛先は送るときに決めるもので、送らずに変えても誰にも届かない。
 */

import type {
  ActionArgs,
  LocalizedText,
  NodeAction,
  NodeActionContext,
  NodeBadge,
  NodeModule,
} from '@conversensus/client/src/nodeActions/nodeAction';
import type { Did } from '@conversensus/shared';
import { detectArrivedRequests } from './requestArrival';
import {
  answerRequest,
  closeRequest,
  reopenRequest,
  sendRequest,
} from './requestEvents';
import {
  ANSWER_TARGET_LINKED_NODE,
  ANSWER_TARGET_PROPERTY,
  addresseeOf,
  isRequestNode,
  type RequestStatus,
  requestStatus,
  sentCountOf,
} from './requestNode';
import { REQUEST_SEED } from './requestTemplate';

/** module の id。操作の鍵は `request/<操作>` になる */
export const REQUEST_MODULE_ID = 'request';

/** 引数の名前 */
const ADDRESSEE_ARG = 'addressee';
const ANSWER_TARGET_ARG = 'answerTarget';
const CONTENT_ARG = 'content';

/** 状態の文言 */
const STATUS_TEXT: Record<RequestStatus, LocalizedText> = {
  draft: { ja: '下書き', en: 'Draft' },
  sent: { ja: '送った・未回答', en: 'Sent, no answer yet' },
  answered: { ja: '回答あり', en: 'Answered' },
  closed: { ja: '閉じた', en: 'Closed' },
};

/** 何回目の送信か (印に添える) */
const SENT_COUNT_TEXT = (n: number): LocalizedText => ({
  ja: `${n} 回目`,
  en: `sent ${n}×`,
});

/** 答えの edge の label (答える人の言語で書く) */
const ANSWER_EDGE_LABEL: LocalizedText = { ja: '答え', en: 'answer' };

const STATUS_TONE: Record<RequestStatus, NodeBadge['tone']> = {
  draft: 'muted',
  sent: 'normal',
  answered: 'primary',
  closed: 'muted',
};

/** 依頼の状態。応答を求める node でなければ undefined */
function statusIn(ctx: NodeActionContext): RequestStatus | undefined {
  return isRequestNode(ctx.node)
    ? requestStatus(ctx.node, ctx.sheet.edges)
    : undefined;
}

const statusIs =
  (...statuses: RequestStatus[]) =>
  (ctx: NodeActionContext) => {
    const status = statusIn(ctx);
    return status !== undefined && statuses.includes(status);
  };

/** 送る・送り直すの引数 (宛先と答えの置き場所)。値は node の property に入る */
const SEND_PARAMS: NodeAction['params'] = [
  {
    name: ADDRESSEE_ARG,
    kind: 'actors',
    label: {
      ja: '宛先 (選ばなければ参加者全員)',
      en: 'Addressees (none = all participants)',
    },
  },
  {
    name: ANSWER_TARGET_ARG,
    kind: 'choice',
    label: { ja: '答えの置き場所', en: 'Where to put the answer' },
    // `newSheet`・`newFile` (D7) はまだ答える側が扱わないので出さない
    options: [
      {
        value: ANSWER_TARGET_LINKED_NODE,
        label: {
          ja: '新しい node (依頼から edge を張る)',
          en: 'A new node linked from the request',
        },
      },
    ],
  },
];

/** dialog の初めの値: 今の宛先と答えの置き場所 (送り直すときは前に送った値) */
function sendInitial(ctx: NodeActionContext): ActionArgs {
  const target = ctx.node.properties?.[ANSWER_TARGET_PROPERTY];
  return {
    [ADDRESSEE_ARG]: addresseeOf(ctx.node) ?? [],
    [ANSWER_TARGET_ARG]:
      typeof target === 'string' ? target : ANSWER_TARGET_LINKED_NODE,
  };
}

function sendWith(ctx: NodeActionContext, args: ActionArgs) {
  return sendRequest(ctx.node, {
    addressee: args[ADDRESSEE_ARG] as readonly Did[],
    answerTarget: args[ANSWER_TARGET_ARG] as string,
  });
}

export const REQUEST_MODULE: NodeModule = {
  id: REQUEST_MODULE_ID,
  actions: [
    {
      id: 'send',
      // 送るのは相手に届く行為。届いて答えが返った後に手元だけ巻き戻さない (やめるなら閉じる)
      undoable: false,
      label: { ja: '送る', en: 'Send' },
      available: statusIs('draft'),
      params: SEND_PARAMS,
      initial: sendInitial,
      run: sendWith,
    },
    {
      id: 'resend',
      // 送るのは相手に届く行為。届いて答えが返った後に手元だけ巻き戻さない (やめるなら閉じる)
      undoable: false,
      label: { ja: '送り直す', en: 'Send again' },
      available: statusIs('sent', 'answered'),
      params: SEND_PARAMS,
      initial: sendInitial,
      run: sendWith,
    },
    {
      id: 'answer',
      label: { ja: '答える', en: 'Answer' },
      available: statusIs('sent', 'answered'),
      params: [
        {
          name: CONTENT_ARG,
          kind: 'text',
          label: { ja: '答え', en: 'Answer' },
          multiline: true,
          required: true,
        },
      ],
      run: (ctx, args) =>
        answerRequest(ctx.sheet, ctx.node, {
          content: args[CONTENT_ARG] as string,
          edgeLabel: ANSWER_EDGE_LABEL[ctx.locale],
        }).event,
    },
    {
      id: 'close',
      label: { ja: '閉じる', en: 'Close' },
      available: statusIs('sent', 'answered'),
      run: (ctx) => closeRequest(ctx.node),
    },
    {
      id: 'reopen',
      label: { ja: '開き直す', en: 'Reopen' },
      available: statusIs('closed'),
      run: (ctx) => reopenRequest(ctx.node),
    },
  ],
  // 「シートを追加 ▾」の「+ 依頼・相談 を追加」(agent 段 4 R2)
  seeds: [REQUEST_SEED],
  // 受信で自分宛てに送られた依頼を知らせる (agent 段 4 R5、設計 D11)。既読の鍵は node と送った回数 —
  // 送り直したら、閉じた人にもまた知らせる (新しい答えが欲しくて送り直している、D12)
  notices: {
    region: { ja: '届いた依頼', en: 'Requests for you' },
    heading: (from) => ({
      ja: `${from} から依頼が届きました`,
      en: `${from} sent you a request`,
    }),
    detect: (input) =>
      detectArrivedRequests(input).map((a) => ({
        key: `${a.nodeId}:${a.sent}`,
        fileId: a.fileId,
        sheetId: a.sheetId,
        nodeId: a.nodeId,
        from: a.from,
        content: a.content,
      })),
  },
  badge: ({ node, outgoing }) => {
    if (!isRequestNode(node)) return undefined;
    // 出ていく edge を数えるのは応答を求める node のときだけ
    const status = requestStatus(node, outgoing());
    const sent = sentCountOf(node);
    return {
      value: status,
      tone: STATUS_TONE[status],
      text:
        sent > 0
          ? {
              ja: `${STATUS_TEXT[status].ja} · ${SENT_COUNT_TEXT(sent).ja}`,
              en: `${STATUS_TEXT[status].en} · ${SENT_COUNT_TEXT(sent).en}`,
            }
          : STATUS_TEXT[status],
    };
  },
};
