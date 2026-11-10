/**
 * 依頼の到着: 受信した op から「自分宛ての依頼が送られた」を見つける (agent 段 4 R5, 設計 D11)
 *
 * 通知の内容は受信のたびに op-log から検出し直し、PDS に置くのは既読だけ (step3 Phase 6) — 依頼も同じ。
 * 送ると、宛先 (空なら参加者全員) に知らせる。
 *
 * ## 通知の対象
 *
 * **この受信で、他の人が `sent` を増やした、自分宛ての、閉じていない依頼**である。
 *
 * - 自分が送ったものは出さない (別の端末から送ったものも — DID で見る)
 * - 送った回数ごとに 1 つ (送り直すと、また知らせる。既読の鍵に回数を含める)
 * - 受信の前から同じ回数だったものは出さない (読み直しのたびに出さない)
 * - template graph の sheet の node は依頼ではない (`requestsInFile` が除く)
 *
 * **他の人の op が `sent` を書いていなければ畳まない。**受信は定期的に走るので、関係の無い受信で
 * File を 2 度畳むのを避ける。
 */

import {
  type Batch,
  type Did,
  didFromActor,
  type FileId,
  type NodeId,
  projectFile,
  type SheetId,
} from '@conversensus/shared';
import {
  isAddressedTo,
  requestsInFile,
  SENT_PROPERTY,
  sentCountOf,
} from './requestNode';

/** 届いた依頼 1 つ */
export type RequestArrival = {
  fileId: FileId;
  sheetId: SheetId;
  nodeId: NodeId;
  /** 何回目の送信か */
  sent: number;
  /** 依頼の本文 (通知に抜粋を出す) */
  content: string;
  /** 送った人 */
  from: Did;
};

export type DetectArrivedRequestsInput = {
  fileId: FileId;
  /** 受信**前**のローカル正典 (trunk) */
  local: readonly Batch[];
  /** 新しく届いた batch */
  incoming: readonly Batch[];
  /** 自分の DID */
  viewer: Did;
};

/** この受信で他の人が書いた `sent`: node → (回数, 書いた人)。同じ node は大きい回数を残す */
function sentByOthers(
  incoming: readonly Batch[],
  viewer: Did,
): Map<string, { sent: number; from: Did }> {
  const found = new Map<string, { sent: number; from: Did }>();
  for (const batch of incoming) {
    const from = didFromActor(batch.actor) as Did;
    if (from === viewer) continue;
    for (const op of batch.ops) {
      if (op.kind !== 'node.setProperty' || op.name !== SENT_PROPERTY) continue;
      const sent = sentCountOf({ properties: { [SENT_PROPERTY]: op.value } });
      if (sent === 0) continue;
      const prev = found.get(op.target);
      if (!prev || prev.sent < sent) found.set(op.target, { sent, from });
    }
  }
  return found;
}

/** 受信で自分宛てに送られた依頼を返す */
export function detectArrivedRequests(
  input: DetectArrivedRequestsInput,
): RequestArrival[] {
  const senders = sentByOthers(input.incoming, input.viewer);
  if (senders.size === 0) return [];
  const before = new Map(
    requestsInFile(projectFile([...input.local], input.fileId)).map((r) => [
      r.node.id as string,
      sentCountOf(r.node),
    ]),
  );
  const after = requestsInFile(
    projectFile([...input.local, ...input.incoming], input.fileId),
  );
  return after.flatMap((r): RequestArrival[] => {
    const sender = senders.get(r.node.id);
    const sent = sentCountOf(r.node);
    if (
      !sender ||
      // 畳んだ結果の回数が、他の人の書いた回数であること (並行に自分が書いた方が勝っていれば出さない)
      sender.sent !== sent ||
      sent <= (before.get(r.node.id) ?? 0) ||
      r.status === 'closed' ||
      !isAddressedTo(r.node, input.viewer)
    ) {
      return [];
    }
    return [
      {
        fileId: input.fileId,
        sheetId: r.sheet.id,
        nodeId: r.node.id,
        sent,
        content: r.node.content,
        from: sender.from,
      },
    ];
  });
}

/**
 * その依頼を最後に送った人 (最後に `sent` を書いた batch の DID)。送っていなければ undefined。
 * 「自分が送った依頼に自分で答えない」ために使う (MCP の `list_requests`)。順序は畳み込みと同じ clock
 */
export function senderOf(
  batches: readonly Batch[],
  nodeId: string,
): Did | undefined {
  let last: { clock: number; from: Did } | undefined;
  for (const batch of batches) {
    const sends = batch.ops.some(
      (op) =>
        op.kind === 'node.setProperty' &&
        op.target === nodeId &&
        op.name === SENT_PROPERTY,
    );
    if (sends && (!last || batch.clock >= last.clock)) {
      last = { clock: batch.clock, from: didFromActor(batch.actor) as Did };
    }
  }
  return last?.from;
}
