/**
 * useEventSyncTap: dispatch された GraphEvent を操作ログへ流す tap を提供する
 * (step1 Phase 4 実配線 W2)
 *
 * ファイルごとに `EventSyncTap` を作り (別ファイルへ push しない)、
 * `useEventStore` の `onEvent` に渡すコールバックを返す。
 * 宛先はローカル永続デーモン (`LocalServerSyncProvider`)。
 */

import type { FileId } from '@conversensus/shared';
import { useCallback, useMemo } from 'react';
import type { GraphEvent } from '../events/GraphEvent';
import { EventSyncTap } from '../sync/eventSyncTap';
import { LocalServerSyncProvider } from '../sync/localServerSyncProvider';

export function useEventSyncTap(fileId: FileId): (event: GraphEvent) => void {
  // fileId が変われば新しい tap (clock/outbox を分離)
  const tap = useMemo(
    () =>
      new EventSyncTap({
        provider: new LocalServerSyncProvider(fileId),
        onError: (error) => console.warn('[sync] batch flush failed:', error),
      }),
    [fileId],
  );
  return useCallback((event: GraphEvent) => tap.record(event), [tap]);
}
