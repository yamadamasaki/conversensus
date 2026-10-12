/**
 * useTimeline: いま見ているシートの version tree を求め、手元の正典が動くたびに読み直す
 * (#73 timeline view, 計画 T3)
 *
 * 読むのは trunk の op-log と、出す branch (Q4) の op-log。読み直しの契機は見るだけの pane と
 * 同じく `subscribeCanonChanges` で、読んだ op-log の File の知らせだけを見る。
 *
 * 選んだ要素 (`focus`) が変わっても読み直さない — 読んだ材料から組み直すだけである
 */

import {
  type Batch,
  type BranchFold,
  type BranchId,
  type FileId,
  foldBranches,
  type SheetId,
} from '@conversensus/shared';
import { useEffect, useMemo, useState } from 'react';
import { fetchBatches as defaultFetchBatches } from '../api';
import { subscribeCanonChanges } from '../local/localChanges';
import {
  buildTimeline,
  isShownBranch,
  type TimelineFocus,
  type TimelineLane,
} from './buildTimeline';

type Material = {
  trunk: Batch[];
  fold: BranchFold;
  branchBatches: Map<BranchId, Batch[]>;
};

export type TimelineState =
  | { kind: 'loading' }
  | { kind: 'ready'; lanes: TimelineLane[] };

async function loadMaterial(
  fileId: FileId,
  sheetId: SheetId,
  fetchBatches: (fileId: FileId) => Promise<Batch[]>,
): Promise<{ material: Material; fileIds: FileId[] }> {
  const trunk = await fetchBatches(fileId);
  const fold = foldBranches(trunk, fileId);
  const shown = [...fold.branches.values()].filter((b) =>
    isShownBranch(b, sheetId),
  );
  const branchBatches = new Map(
    await Promise.all(
      shown.map(
        async (b) => [b.id, await fetchBatches(b.branchFileId)] as const,
      ),
    ),
  );
  return {
    material: { trunk, fold, branchBatches },
    fileIds: [fileId, ...shown.map((b) => b.branchFileId)],
  };
}

export function useTimeline(
  place: { fileId: FileId; sheetId: SheetId } | null,
  focus: TimelineFocus | undefined,
  fetchBatches: (fileId: FileId) => Promise<Batch[]> = defaultFetchBatches,
): TimelineState {
  const [material, setMaterial] = useState<Material | null>(null);
  const fileId = place?.fileId ?? null;
  const sheetId = place?.sheetId ?? null;

  useEffect(() => {
    setMaterial(null);
    if (fileId === null || sheetId === null) return;
    let cancelled = false;
    let watched = new Set<string>([fileId]);
    // 読み込みが重なったら、最後に始めたものだけを採る (古い結果で上書きしない)
    let generation = 0;
    const load = () => {
      const mine = ++generation;
      loadMaterial(fileId, sheetId, fetchBatches)
        .then((result) => {
          if (cancelled || mine !== generation) return;
          watched = new Set(result.fileIds);
          setMaterial(result.material);
        })
        .catch((error) =>
          console.warn('[timeline] 履歴を読めなかった:', error),
        );
    };
    load();
    const stop = subscribeCanonChanges(({ fileId: changed }) => {
      if (watched.has(changed)) load();
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [fileId, sheetId, fetchBatches]);

  return useMemo(
    () =>
      material && sheetId !== null
        ? {
            kind: 'ready',
            lanes: buildTimeline({ sheetId, ...material, focus }),
          }
        : { kind: 'loading' },
    [material, sheetId, focus],
  );
}
