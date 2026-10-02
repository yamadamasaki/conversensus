/**
 * タブ間の知らせ (step3 Phase 2 D3)
 *
 * タブはそれぞれ Worker を立て、同じ OPFS の DB に接続を持つ。あるタブが書いた batch は
 * DB には入るが、**他のタブの画面は知らない**。書いたタブが BroadcastChannel で知らせ、
 * 受けたタブは「手元の正典に、画面に出ていない batch があるか」を測り直す
 * (`useFileSheetOperations` の #202 の経路と同じ)。
 *
 * BroadcastChannel は**送った channel 自身には届かない**ので、自分の書き込みで自分を
 * 測り直すことは無い。channel はタブに 1 つだけ持つ (送りと受けを同じ object にするため)。
 */

import type { FileId } from '@conversensus/shared';
import type { LocalBackend } from './backend';

/** BroadcastChannel の名前 */
export const LOCAL_CHANGES_CHANNEL = 'conversensus-local-changes';

/** 知らせの本文。どの File の op-log が動いたか */
export type LocalChange = { fileId: FileId };

/** BroadcastChannel のうち使う部分 */
export type ChannelLike = {
  postMessage(message: LocalChange): void;
  addEventListener(
    type: 'message',
    listener: (event: { data: LocalChange }) => void,
  ): void;
  removeEventListener(
    type: 'message',
    listener: (event: { data: LocalChange }) => void,
  ): void;
};

let channel: ChannelLike | null | undefined;

/** タブに 1 つの channel。BroadcastChannel が無い環境 (古いブラウザ) では null */
function tabChannel(): ChannelLike | null {
  if (channel === undefined) {
    channel =
      typeof BroadcastChannel === 'undefined'
        ? null
        : (new BroadcastChannel(
            LOCAL_CHANGES_CHANNEL,
          ) as unknown as ChannelLike);
  }
  return channel;
}

/**
 * **このタブの中**で正典が動いたことを受ける口 (step3 Phase 3 S3-5)。BroadcastChannel は送った
 * channel 自身に届かないので、同じタブの中の知らせは別に持つ。見るだけの pane (multiple モード) が、
 * アクティブな pane の編集・merge・受信で動いた正典を読み直すのに使う
 */
const ownListeners = new Set<(change: LocalChange) => void>();

/**
 * 書き込みのたびに知らせるバックエンドで包む。他のタブへは `target` で、このタブの中へは
 * `subscribeOwnChanges` の受け手へ。**書けたときだけ**知らせる (失敗した書き込みで測り直させない)。
 * `target` が無い (BroadcastChannel の無い環境・テスト) ときも、このタブの中へは知らせる
 */
export function broadcastingBackend(
  backend: LocalBackend,
  target: ChannelLike | null = tabChannel(),
): LocalBackend {
  const notify = (fileId: FileId) => {
    target?.postMessage({ fileId });
    for (const listener of ownListeners) listener({ fileId });
  };
  return {
    ...backend,
    createFile: async (name) => {
      const file = await backend.createFile(name);
      notify(file.id);
      return file;
    },
    postImportFile: async (data) => {
      const file = await backend.postImportFile(data);
      notify(file.id);
      return file;
    },
    pushBatches: async (fileId, batches) => {
      const appended = await backend.pushBatches(fileId, batches);
      if (appended > 0) notify(fileId);
      return appended;
    },
    pushReceivedBatches: async (fileId, batches) => {
      const appended = await backend.pushReceivedBatches(fileId, batches);
      if (appended > 0) notify(fileId);
      return appended;
    },
  };
}

/** 他のタブの書き込みを受ける。@returns 購読をやめる関数 */
export function subscribeLocalChanges(
  listener: (change: LocalChange) => void,
  source: ChannelLike | null = tabChannel(),
): () => void {
  if (!source) return () => {};
  const handler = (event: { data: LocalChange }) => listener(event.data);
  source.addEventListener('message', handler);
  return () => source.removeEventListener('message', handler);
}

/** このタブ自身の書き込みを受ける。@returns 購読をやめる関数 */
export function subscribeOwnChanges(
  listener: (change: LocalChange) => void,
): () => void {
  ownListeners.add(listener);
  return () => ownListeners.delete(listener);
}

/**
 * 手元の正典が動いた (このタブの書き込み + 別のタブの書き込み)。画面に出ているものを正典から
 * 読み直す側 (見るだけの pane) が使う。@returns 購読をやめる関数
 */
export function subscribeCanonChanges(
  listener: (change: LocalChange) => void,
  source: ChannelLike | null = tabChannel(),
): () => void {
  const stopOthers = subscribeLocalChanges(listener, source);
  const stopOwn = subscribeOwnChanges(listener);
  return () => {
    stopOthers();
    stopOwn();
  };
}
