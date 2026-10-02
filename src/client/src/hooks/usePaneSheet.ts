/**
 * usePaneSheet: 見るだけの pane の中身をアドレスから求め、手元の正典が動くたびに読み直す
 * (step3 Phase 3 S3-5)
 *
 * 読み直す契機は「このタブ + 別のタブの書き込み」(`subscribeCanonChanges`)。アクティブな pane の
 * 編集・merge・受信、別のブラウザのタブの書き込みのどれで正典が動いても、ここに届く。
 * **読んだ op-log の File の知らせだけを見る** (branch のアドレスは trunk と branch 専用の op-log)
 */

import type { GraphViewAddress } from '@conversensus/shared';
import { addressKey } from '@conversensus/shared';
import { useEffect, useState } from 'react';
import { fetchBatches } from '../api';
import { subscribeCanonChanges } from '../local/localChanges';
import { type AddressSheet, loadAddressSheet } from '../sync/loadAddressSheet';

export type PaneSheetState = { kind: 'loading' } | AddressSheet;

export function usePaneSheet(address: GraphViewAddress): PaneSheetState {
  const [state, setState] = useState<PaneSheetState>({ kind: 'loading' });
  const key = addressKey(address);

  // biome-ignore lint/correctness/useExhaustiveDependencies: アドレスの同一性 (key) が変わったときだけ読み直す
  useEffect(() => {
    let cancelled = false;
    let watched = new Set<string>([address.fileId]);
    // 読み込みが重なったら、最後に始めたものだけを採る (古い結果で上書きしない)
    let generation = 0;
    const load = () => {
      const mine = ++generation;
      loadAddressSheet(address, fetchBatches)
        .then((result) => {
          if (cancelled || mine !== generation) return;
          watched = new Set(result.fileIds);
          setState(result);
        })
        .catch((error) =>
          console.warn('[pane] アドレスの中身を読めなかった:', error),
        );
    };
    load();
    const stop = subscribeCanonChanges(({ fileId }) => {
      if (watched.has(fileId)) load();
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [key]);

  return state;
}
