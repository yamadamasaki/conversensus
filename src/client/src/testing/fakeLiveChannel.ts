/**
 * App 結合テストの流れ (#252)。WebSocket を開かず、合図はテストが手で出す
 *
 * 本物 (`LiveChannel`) は PDS の firehose を読むが、偽の PDS (`fakePds`) は firehose を持たない。
 * 合図から先 (受信のセッションが取りに行く) は本物なので、App の層で見たいのはそこである。
 */

import type { FileId } from '@conversensus/shared';
import type { LiveHint, LiveSignal } from '../sync/liveChannel';

export class FakeLiveChannel implements LiveSignal {
  /** 繋がっているか。既定は繋がっていない (既存のテストの定期同期を変えない) */
  connected = false;
  private readonly listeners = new Set<(hint: LiveHint) => void>();

  isConnected(): boolean {
    return this.connected;
  }

  onHint(listener: (hint: LiveHint) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): () => void {
    return () => {};
  }

  /** この File に書き込みがあった、と知らせる */
  hint(fileId: FileId | null): void {
    for (const listener of this.listeners) listener({ fileId });
  }
}
