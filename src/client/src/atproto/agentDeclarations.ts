/**
 * DID が agent であるかを PDS から読む (設計 agent-actor.md D2)
 *
 * agent の repo の宣言を読み、宣言が指す operator の repo から裏付けを読んで、状態を導く (`agentDeclarationOf`)。
 * **裏付けは宣言の operator の repo からだけ読む** — 別の repo に「この agent は私のもの」と書かれていても数えない。
 * 画面は覚えておく (`createAgentDeclarationCache`)。認めた・取り消したときは忘れて読み直す。
 */

import {
  type AgentDeclaration,
  AgentProfileSchema,
  agentDeclarationOf,
  type Did,
} from '@conversensus/shared';
import { agentRecords } from './collections';

/** DID 1 つの宣言と裏付けを読む。読めなければ agent ではない (表示にだけ使う) */
export async function readAgentDeclaration(
  did: Did,
): Promise<AgentDeclaration> {
  const profile = await agentRecords.getProfile(did);
  const parsed = AgentProfileSchema.safeParse(profile);
  const operated = parsed.success
    ? await agentRecords.getOperated(parsed.data.operator as Did, did)
    : undefined;
  return agentDeclarationOf(did, profile, operated);
}

export type AgentDeclarationCache = {
  /** 覚えていればそれを、無ければ読んで覚える */
  get: (did: Did) => Promise<AgentDeclaration>;
  /** 忘れる (認めた・取り消した後に読み直すため) */
  forget: (did: Did) => void;
};

/** 読んだ宣言を DID ごとに覚えておく (同じ DID を何度も読まない。読んでいる最中のものも重ねない) */
export function createAgentDeclarationCache(
  read: (did: Did) => Promise<AgentDeclaration> = readAgentDeclaration,
): AgentDeclarationCache {
  const known = new Map<Did, Promise<AgentDeclaration>>();
  return {
    get: (did) => {
      let found = known.get(did);
      if (!found) {
        found = read(did);
        known.set(did, found);
      }
      return found;
    },
    forget: (did) => {
      known.delete(did);
    },
  };
}
