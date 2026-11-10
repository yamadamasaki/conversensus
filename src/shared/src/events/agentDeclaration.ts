/**
 * agent の宣言と operator の裏付け (設計 agent-actor.md D2、A3・A7)
 *
 * DID が **agent であり、誰のものか**は、2 つの record から導く。どちらも File をまたぐ話なので op-log には
 * 置かず、actor の repo に置く。表示にだけ使い、conversensus の振舞いは変えない (設計 §1.1)。
 *
 * | record | 置く repo | rkey | 中身 |
 * | --- | --- | --- | --- |
 * | `agentProfile` | agent | `self` | operator の DID・model・説明 |
 * | `operatedAgent` | operator | agent の DID | agent の DID |
 *
 * **両方がそろい、互いを指していれば**「裏付けあり」。片方だけなら「名乗りのみ」(宣言だけ) か、何でもない
 * (裏付けだけ — 名乗っていない DID を、他の人が勝手に agent と呼ぶことはできない)。
 *
 * 値は他の人の repo から来るので、**形が違っても落ちない**。読めない record は「無い」と同じに扱う。
 */

import { z } from 'zod';
import type { Did } from '../schemas';

/** agent の宣言の rkey (1 つの repo に 1 つ) */
export const AGENT_PROFILE_RKEY = 'self';

/** DID の綴り (中身の検証は PDS がする。ここでは空でない文字列) */
const DidStringSchema = z.string().min(1);

/** agent の宣言 (agent の repo) */
export const AgentProfileSchema = z.object({
  operator: DidStringSchema,
  /** 言語モデルの名前 (任意) */
  model: z.string().optional(),
  /** 何をする agent か (任意) */
  description: z.string().optional(),
});
export type AgentProfile = z.infer<typeof AgentProfileSchema>;

/** operator の裏付け (operator の repo、rkey = agent の DID) */
export const OperatedAgentSchema = z.object({ agent: DidStringSchema });
export type OperatedAgent = z.infer<typeof OperatedAgentSchema>;

/** agent であるかの状態 */
export type AgentStatus = 'none' | 'claimed' | 'verified';

/** 表示に使う、DID 1 つについての導出 */
export type AgentDeclaration =
  | { status: 'none' }
  | {
      status: 'claimed' | 'verified';
      operator: Did;
      model?: string;
      description?: string;
    };

export const NOT_AN_AGENT: AgentDeclaration = { status: 'none' };

/**
 * DID 1 つの状態を導く。
 *
 * @param did 調べる DID
 * @param profile その DID の repo の `agentProfile` (無ければ undefined)
 * @param operated 宣言が指す operator の repo の、rkey = `did` の `operatedAgent` (無ければ undefined)。
 *   **呼ぶ側は宣言の operator の repo から読む** — 別の repo の裏付けは数えない
 */
export function agentDeclarationOf(
  did: Did,
  profile: unknown,
  operated: unknown,
): AgentDeclaration {
  const p = AgentProfileSchema.safeParse(profile);
  if (!p.success) return NOT_AN_AGENT;
  const o = OperatedAgentSchema.safeParse(operated);
  const verified = o.success && o.data.agent === did;
  return {
    status: verified ? 'verified' : 'claimed',
    operator: p.data.operator,
    ...(p.data.model !== undefined && { model: p.data.model }),
    ...(p.data.description !== undefined && {
      description: p.data.description,
    }),
  };
}
