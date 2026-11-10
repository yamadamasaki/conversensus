/**
 * 参加者の agent の宣言を読み、operator として認める・やめる (設計 agent-actor.md D2、計画 agent-d2-declaration.md A3)
 *
 * 宣言は actor の repo にあり、File をまたぐ。参加者一覧が開いている間だけ読み、DID ごとに覚えておく
 * (`createAgentDeclarationCache`)。**一覧を閉じたらすべて忘れる** — 開き直したときに、その間に agent が書いた宣言を
 * 拾うためである。認めた・やめたときは、その DID を忘れて読み直す。表示にだけ使い、conversensus の振舞いは変えない。
 */

import type { AgentDeclaration, Did } from '@conversensus/shared';
import { useCallback, useEffect, useState } from 'react';
import { createAgentDeclarationCache } from '../atproto/agentDeclarations';
import { agentRecords } from '../atproto/collections';

/** 一覧が開いている間に読んだ宣言 */
const cache = createAgentDeclarationCache();

export function useAgentDeclarations(
  dids: readonly Did[],
  signedIn: boolean,
): {
  /** 読めていれば宣言。まだなら undefined */
  declarationOf: (did: Did) => AgentDeclaration | undefined;
  /** 自分の agent と認める (true) / やめる (false) */
  acknowledge: (agent: Did, yes: boolean) => Promise<void>;
} {
  const [known, setKnown] = useState<ReadonlyMap<Did, AgentDeclaration>>(
    () => new Map(),
  );
  const record = useCallback((did: Did, d: AgentDeclaration) => {
    setKnown((prev) => new Map(prev).set(did, d));
  }, []);

  const key = dids.join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: DID の並びが変わったときだけ読む (配列の同一性では見ない)
  useEffect(() => {
    if (dids.length === 0) {
      // 一覧を閉じた: 忘れる (次に開いたときに読み直す)
      cache.clear();
      setKnown(new Map());
      return;
    }
    if (!signedIn) return;
    let cancelled = false;
    for (const did of dids) {
      void cache.get(did).then((d) => {
        if (!cancelled) record(did, d);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [key, signedIn, record]);

  const acknowledge = useCallback(
    async (agent: Did, yes: boolean) => {
      if (yes) await agentRecords.putOperated(agent);
      else await agentRecords.deleteOperated(agent);
      cache.forget(agent);
      record(agent, await cache.get(agent));
    },
    [record],
  );

  return {
    declarationOf: (did) => known.get(did),
    acknowledge,
  };
}
