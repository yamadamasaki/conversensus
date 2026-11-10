/**
 * 開いている File の node・edge を書いた人 (#354、設計 agent-actor.md D2a)
 *
 * File の op-log (trunk と、見ている branch) を読み、作者を導く (`authorsOf`)。手元の正典が変わったら読み直す
 * (timeline view と同じ — `subscribeCanonChanges`)。作者のハンドル名と agent の宣言も引く。宣言は参加者一覧と
 * 同じ入れ物を使う (`agentDeclarationCache`)。
 */

import {
  type AgentDeclaration,
  type Authors,
  authorsOf,
  type Batch,
  type Did,
  type FileId,
} from '@conversensus/shared';
import { useEffect, useMemo, useState } from 'react';
import { fetchBatches as defaultFetchBatches } from '../api';
import { agentDeclarationCache } from '../atproto/agentDeclarations';
import { handleLabels } from '../atproto/identity';
import type { AuthorsView } from '../graph/authorsContext';
import { subscribeCanonChanges } from '../local/localChanges';

const NO_AUTHORS: Authors = new Map();
const NONE: readonly Did[] = [];

/**
 * @param fileIds 作者を読む op-log (trunk と、見ている branch)。空なら読まない
 * @param signedIn ログインしていなければ、表示名と宣言は引かない (PDS に問い合わせられない)
 */
export function useElementAuthors(
  fileIds: readonly FileId[],
  signedIn: boolean,
  fetchBatches: (fileId: FileId) => Promise<Batch[]> = defaultFetchBatches,
): AuthorsView {
  const [authors, setAuthors] = useState<Authors>(NO_AUTHORS);
  const [labelOf, setLabelOf] = useState<(did: Did) => string>(
    () => (did: Did) => did,
  );
  const [declarations, setDeclarations] = useState<
    ReadonlyMap<Did, AgentDeclaration>
  >(() => new Map());

  const key = fileIds.join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: File の並びが変わったときだけ読み直す (配列の同一性では見ない)
  useEffect(() => {
    setAuthors(NO_AUTHORS);
    if (fileIds.length === 0) return;
    let cancelled = false;
    // 読み込みが重なったら、最後に始めたものだけを採る
    let generation = 0;
    const load = () => {
      const mine = ++generation;
      Promise.all(fileIds.map((id) => fetchBatches(id)))
        .then((logs) => {
          if (!cancelled && mine === generation) {
            setAuthors(authorsOf(logs.flat()));
          }
        })
        .catch((error) =>
          console.warn('[authors] op-log を読めなかった:', error),
        );
    };
    load();
    const watched = new Set<string>(fileIds);
    const stop = subscribeCanonChanges(({ fileId }) => {
      if (watched.has(fileId)) load();
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [key, fetchBatches]);

  // 作者の表示名と agent の宣言を引く (作者が変わったときだけ)
  const dids = useMemo(
    () => [...new Set([...authors.values()].flat())].sort(),
    [authors],
  );
  const didsKey = dids.join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: 作者の集合が変わったときだけ引く
  useEffect(() => {
    if (!signedIn || dids.length === 0) return;
    let cancelled = false;
    void handleLabels.resolve(dids).then((resolved) => {
      if (!cancelled) setLabelOf(() => resolved);
    });
    for (const did of dids) {
      void agentDeclarationCache.get(did).then((d) => {
        if (!cancelled) setDeclarations((prev) => new Map(prev).set(did, d));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [didsKey, signedIn]);

  return useMemo(
    () => ({
      authorsOf: (id: string) => authors.get(id) ?? NONE,
      labelOf,
      agentOf: (did: Did) => declarations.get(did),
    }),
    [authors, labelOf, declarations],
  );
}
