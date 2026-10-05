/**
 * この端末にだけある (未ログインの actor の) batch の数 (FPR 前 L-3)。
 *
 * **ログインしていないときだけ数える** (`enabled`)。ログイン中はログインの直後に出し直すか
 * 訊く (L-1) ので、数える意味が無い。このタブと別のタブの書き込みのたびに数え直す。
 */

import { useEffect, useState } from 'react';
import { listLocalActorBatches } from '../api';
import {
  subscribeLocalChanges,
  subscribeOwnChanges,
} from '../local/localChanges';

export function useLocalOnlyCount(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }
    let cancelled = false;
    const recount = () => {
      listLocalActorBatches()
        .then((rows) => {
          if (!cancelled) setCount(rows.reduce((n, row) => n + row.count, 0));
        })
        .catch(() => {});
    };
    recount();
    const offOwn = subscribeOwnChanges(recount);
    const offOther = subscribeLocalChanges(recount);
    return () => {
      cancelled = true;
      offOwn();
      offOther();
    };
  }, [enabled]);
  return count;
}
