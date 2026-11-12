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

/** DID の長さの上限 (atproto の DID の規則) */
const DID_MAX_LENGTH = 2048;
/** model の長さの上限 (#392) */
export const AGENT_MODEL_MAX_LENGTH = 100;
/** 説明の長さの上限 (#392) */
export const AGENT_DESCRIPTION_MAX_LENGTH = 1000;

/**
 * DID の形 (#392)。atproto の DID の構文 (`did:<method>:<id>`) に合わせる。宣言は他人の repo から読み、
 * 参加者一覧に出し、operator の repo を読みに行く先にもなるので、空でない文字列なら何でも通す、をやめる
 */
export const DidStringSchema = z
  .string()
  .max(DID_MAX_LENGTH)
  .regex(/^did:[a-z]+:[a-zA-Z0-9._:%-]*[a-zA-Z0-9._-]$/);

/** agent の宣言 (agent の repo)。lexicon は `lexicons/app/conversensus/v2/agentProfile.json` */
export const AgentProfileSchema = z.object({
  operator: DidStringSchema,
  /** 言語モデルの名前 (任意) */
  model: z.string().max(AGENT_MODEL_MAX_LENGTH).optional(),
  /** 何をする agent か (任意) */
  description: z.string().max(AGENT_DESCRIPTION_MAX_LENGTH).optional(),
});
export type AgentProfile = z.infer<typeof AgentProfileSchema>;

/** operator の裏付け (operator の repo、rkey = agent の DID)。lexicon は `operatedAgent.json` */
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
