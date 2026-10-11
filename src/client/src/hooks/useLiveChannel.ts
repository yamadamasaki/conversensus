/**
 * useLiveChannel: 参加者の PDS の流れ (#252) をログインしている間だけ開く
 *
 * 流れは合図を受信の側 (`FileSession`) へ配るだけで、取りに行くのは受信の経路である。取りに行けるのは
 * ログインしている間だけ (remote キューが要る) なので、そのときだけ繋ぐ。
 *
 * 繋ぐ先は今は自分の PDS 1 つ (全員がそこにいる)。連合では、開いている File の参加者の PDS を
 * DID から解決して渡す (`liveChannel.ts` の冒頭)。
 */

import { useEffect, useMemo } from 'react';
import { PDS_URL } from '../atproto/client';
import { browserLiveChannel, type LiveSignal } from '../sync/liveChannel';

/** 流れの作り方。App 結合テストは WebSocket の代わりに合図を手で出す偽物を入れる */
export type LiveChannelFactory = (
  pdsUrls: readonly string[],
) => LiveSignal & { start(): () => void };

let factory: LiveChannelFactory = browserLiveChannel;

/** 流れの作り方を差し替える (App 結合テスト)。null で既定 (WebSocket) に戻す */
export function setLiveChannelFactory(next: LiveChannelFactory | null): void {
  factory = next ?? browserLiveChannel;
}

export function useLiveChannel(enabled: boolean): LiveSignal | null {
  const channel = useMemo(
    () => (enabled ? factory([PDS_URL]) : null),
    [enabled],
  );
  useEffect(() => channel?.start(), [channel]);
  return channel;
}
