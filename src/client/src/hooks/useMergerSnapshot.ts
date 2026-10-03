/**
 * useMergerSnapshot: merger の姿 (元・先・後) と競合を、手元の正典が動くたびに読み直す
 * (step3 Phase 5)
 *
 * 読み直す契機は trunk と branch の op-log の知らせ (`subscribeCanonChanges`)。merge 先 (trunk) が
 * 受信で進めば、先・後・競合が作り直される (O3)。`trunkVersion` は trunk の batch の数で、merge 後の
 * canvas を seed し直す合図に使う — 自分の解決の編集 (branch に積む) では変わらないので、編集の途中で
 * canvas が入れ替わらない
 */

import type { BranchMeta, VersionVector } from '@conversensus/shared';
import { useEffect, useState } from 'react';
import { fetchBatches } from '../api';
import { subscribeCanonChanges } from '../local/localChanges';
import { type MergerSnapshot, mergerSnapshot } from '../sync/merger';

export type MergerState = { snapshot: MergerSnapshot; trunkVersion: number };

export function useMergerSnapshot(
  branch: BranchMeta | undefined,
  startedAt: VersionVector | undefined,
): MergerState | null {
  const [state, setState] = useState<MergerState | null>(null);
  const key =
    branch && startedAt ? `${branch.id}/${JSON.stringify(startedAt)}` : '';

  // biome-ignore lint/correctness/useExhaustiveDependencies: branch と開いた時点 (key) が変わったときだけ張り直す
  useEffect(() => {
    if (!branch || !startedAt) {
      setState(null);
      return;
    }
    let cancelled = false;
    let generation = 0;
    const load = () => {
      const mine = ++generation;
      Promise.all([
        fetchBatches(branch.trunkFileId),
        fetchBatches(branch.branchFileId),
      ])
        .then(([trunk, branchBatches]) => {
          if (cancelled || mine !== generation) return;
          setState({
            snapshot: mergerSnapshot(branch, trunk, branchBatches, startedAt),
            trunkVersion: trunk.length,
          });
        })
        .catch((error) => console.warn('[merger] 読めなかった:', error));
    };
    load();
    const stop = subscribeCanonChanges(({ fileId }) => {
      if (fileId === branch.trunkFileId || fileId === branch.branchFileId)
        load();
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [key]);

  return state;
}
