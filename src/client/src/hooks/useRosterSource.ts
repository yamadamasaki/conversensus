/**
 * useRosterSource: 名簿の供給元を App レベルで 1 つ作る (step2 Phase 2 S1)
 *
 * `useRemoteSyncQueue` と同じ形 — **2 箇所から使われるので App レベルで保持する**。
 *
 *   - 参加者ダイアログ (`useParticipation`)
 *   - 同期サイクル (Phase 2 S2: 「読む順序は名簿 → グラフ」の前半)
 *
 * 別々に作ると読みが畳まれず、起点の修復 (`ensureOwnGenesis`) も二重に走る。
 *
 * DID が変われば別 repo の名簿になるので作り直す。**未ログインでも作る** — 名簿の読みは
 * 実際に呼ばれたときに初めて PDS を叩くので、ここで null を返す意味が無い
 * (`useRemoteSyncQueue` が null を返すのは、キューが未ログインでは送り先を持てないため)。
 */

import type { Actor, FileId, JudgmentBatch } from '@conversensus/shared';
import { didFromActor } from '@conversensus/shared';
import { useMemo } from 'react';
import { fetchBatches } from '../api';
import { loadRoster, putJudgment } from '../atproto/judgmentStore';
import { ensureOwnGenesis } from '../sync/ensureOwnGenesis';
import type { RosterSource } from '../sync/rosterSource';
import { createRosterSource } from '../sync/rosterSource';

export function useRosterSource(actor: Actor): RosterSource {
  return useMemo(
    () =>
      createRosterSource({
        loadRoster,
        ensureOwnGenesis: (fileId: FileId, known: readonly JudgmentBatch[]) =>
          ensureOwnGenesis({ fetchBatches, putJudgment, actor }, fileId, known),
        viewer: didFromActor(actor),
      }),
    [actor],
  );
}
