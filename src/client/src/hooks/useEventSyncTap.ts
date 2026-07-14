/**
 * useEventSyncTap: dispatch された GraphEvent を操作ログへ流す tap を提供する
 * (step1 Phase 4 実配線 W2)
 *
 * ファイルごとに `EventSyncTap` を作り (別ファイルへ push しない)、
 * `useEventStore` の `onEvent` に渡すコールバックを返す。
 * 宛先はローカル永続デーモン (`LocalServerSyncProvider`)。
 */

import type { FileId, SheetId } from '@conversensus/shared';
import { useCallback, useMemo } from 'react';
import type { GraphEvent } from '../events/GraphEvent';
import { EventSyncTap } from '../sync/eventSyncTap';
import { LocalServerSyncProvider } from '../sync/localServerSyncProvider';

export function useEventSyncTap(
  fileId: FileId | null,
): (event: GraphEvent, sheetId?: SheetId) => void {
  // fileId が変われば新しい tap (clock/outbox を分離)。未オープン時は no-op。
  const tap = useMemo(
    () =>
      fileId
        ? new EventSyncTap({
            provider: new LocalServerSyncProvider(fileId),
            onError: (error) =>
              console.warn('[sync] batch flush failed:', error),
          })
        : null,
    [fileId],
  );
  // content 経路は sheetId を渡す (W3c2)。structure 経路は省略 → file-level batch。
  return useCallback(
    (event: GraphEvent, sheetId?: SheetId) => tap?.record(event, sheetId),
    [tap],
  );
}
