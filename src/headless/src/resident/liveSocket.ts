/**
 * headless の流れの口 (agent 段 5 S2)。ブラウザの `browserLiveChannel` と同じ `LiveChannel` を、
 * 画面の無いプロセス向けの口で作る。
 *
 * ブラウザは「画面が見えていて回線がある」ときだけ繋ぐ。常駐の agent は**いつも繋ぐ** — 見ている人は
 * いないが、合図を待つのが仕事である。切れたときの繋ぎ直し (間隔を延ばしながら) は `LiveChannel` が持つ。
 */

import { LiveChannel } from '@conversensus/client/src/sync/liveChannel';

export function headlessLiveChannel(
  pdsUrls: readonly string[],
  options: { reconnectMinMs?: number; reconnectMaxMs?: number } = {},
): LiveChannel {
  return new LiveChannel({
    pdsUrls,
    createSocket: (url, { onOpen, onMessage, onClose }) => {
      const socket = new WebSocket(url);
      socket.binaryType = 'arraybuffer';
      socket.onopen = onOpen;
      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) onMessage(event.data);
      };
      socket.onclose = onClose;
      return socket;
    },
    isActive: () => true,
    watchActivity: () => () => {},
    ...options,
  });
}
