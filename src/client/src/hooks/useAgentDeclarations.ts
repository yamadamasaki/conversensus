/**
 * 参加者の agent の宣言を読み、operator として認める・やめる (設計 agent-actor.md D2、計画 agent-d2-declaration.md A3)
 *
 * 宣言は actor の repo にあり、File をまたぐ。参加者一覧が開いている間だけ読み、DID ごとに覚えておく
 * (`createAgentDeclarationCache`)。**一覧を閉じたらすべて忘れる** — 開き直したときに、その間に agent が書いた宣言を
 * 拾うためである。認めた・やめたときは、その DID を忘れて読み直す。表示にだけ使い、conversensus の振舞いは変えない。
 *
 * **operator のハンドル名も引いてから出す** (#392)。operator は File の参加者とは限らず、名簿のハンドル名には無い。
 * 引いたものは共有のハンドル名の cache (`handleLabels`) に入り、一覧の `labelOf` (同じ cache を見る) で出る。
 */

import type { AgentDeclaration, Did } from '@conversensus/shared';
import { useCallback, useEffect, useState } from 'react';
import { agentDeclarationCache as cache } from '../atproto/agentDeclarations';
import { agentRecords } from '../atproto/collections';
import { handleLabels } from '../atproto/identity';

/** 宣言を読み、agent なら operator のハンドル名も引いておく (読めなければ DID のまま出る) */
async function withOperatorLabel(
  read: Promise<AgentDeclaration>,
  resolveLabels: (dids: Did[]) => Promise<unknown>,
): Promise<AgentDeclaration> {
  const d = await read;
  if (d.status !== 'none') await resolveLabels([d.operator]);
  return d;
}

export function useAgentDeclarations(
  dids: readonly Did[],
  signedIn: boolean,
  /** ハンドル名を引く口 (既定は共有の cache。試験で差し替える) */
  resolveLabels: (dids: Did[]) => Promise<unknown> = handleLabels.resolve,
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
      void withOperatorLabel(cache.get(did), resolveLabels).then((d) => {
        if (!cancelled) record(did, d);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [key, signedIn, record, resolveLabels]);

  const acknowledge = useCallback(
    async (agent: Did, yes: boolean) => {
      if (yes) await agentRecords.putOperated(agent);
      else await agentRecords.deleteOperated(agent);
      cache.forget(agent);
      record(agent, await withOperatorLabel(cache.get(agent), resolveLabels));
    },
    [record, resolveLabels],
  );

  return {
    declarationOf: (did) => known.get(did),
    acknowledge,
  };
}
