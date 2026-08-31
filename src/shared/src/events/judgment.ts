/**
 * 判断ログの語彙 (step2 Phase 1)
 *
 * 設計: `deepse/plans/step2-phase1-participation.md`
 * 仕様: `deepse/requirements/spec/participation.md`
 *
 * グラフの op-log とは**別の collection** に置く。理由は畳み込みの意味論が違うことで、
 * ここの op は **pre 条件を検証して満たさないものを捨てる**が、グラフの op は
 * LWW / add-wins で解決するので「無効な op」という概念がない
 * (`deepse/architecture/step2.md` §3)。
 *
 * **「名簿」ではなく「判断ログ」として広く切ってある。** DtR の承認 (Phase 6) も同じ
 * 「検証して捨てる」畳み込みなので、名簿専用に切ると 3 つ目の collection が要る。
 * `dtr.*` の op はこの union に後から加わる。
 *
 * **clock 空間はグラフの op-log と共有する。** pre 条件が「この操作より前」を含む以上、
 * 2 つのログを同じ物差しで並べられなければならない (`deepse/spikes/u6-p2-report.md` の
 * 検証 5)。ここに独立した採番を作ってはならない。
 */

import { z } from 'zod';
import { BatchIdSchema } from './unified';

/**
 * 判断の主体・対象となる DID。
 *
 * `schemas.ts` の `Did` は `string` のエイリアスだが、ここでは**空でないこと**だけ
 * 課す。DID の書式そのものを検証しないのは、`did:plc:` / `did:web:` など方式が
 * 複数あり、しかも「自分の PDS に属するか」は書式では決まらないためである
 * (それは pre 条件として `foldParticipation` が判定する)。
 */
export const JudgmentDidSchema = z.string().min(1);

/**
 * 判断 op
 *
 * **取り消し (`revoke`) は承認の前後を問わず 1 つの op である** (仕様の決定)。
 * 招待の取り消しと参加の取り消しを別の op にすると、境界に「どちらでもない」状態が
 * 生まれる。
 *
 * **招待を断る op は無い** (仕様)。承認しなければよい。
 *
 * `target` を持つのは他者に働きかける 2 つだけで、残りは**発行者自身**が対象である
 * (発行者は batch の `actor` から DID を取り出して決まる)。
 */
export const JudgmentOpSchema = z.discriminatedUnion('kind', [
  /**
   * この File の最初の参加者を宣言する (事実 7 の答え)。
   *
   * `file.create` op が無く genesis batch の actor は固定値なので、**作成者の DID が
   * グラフの op-log のどこにも載っていない**。名簿の起点は名簿の中に置く —
   * グラフ側から取り出そうとすると、判断の畳み込みがグラフの畳み込みに依存して
   * 一方向性が崩れる (`deepse/spikes/u6-p2-report.md`)。
   *
   * 自己申告でよいのは、名簿の読み出しに起点があり、**起点と繋がっていない genesis は
   * そもそも読まれない**からである (`deepse/architecture/step2.md` §2)。
   */
  z.object({ kind: z.literal('participation.genesis') }),
  /** 発行者が `target` を招待する */
  z.object({
    kind: z.literal('participation.invite'),
    target: JudgmentDidSchema,
  }),
  /** 発行者が自分への招待を承認する */
  z.object({ kind: z.literal('participation.accept') }),
  /** 発行者が自分の参加を取りやめる */
  z.object({ kind: z.literal('participation.resign') }),
  /** 発行者が `target` の招待/参加を取り消す */
  z.object({
    kind: z.literal('participation.revoke'),
    target: JudgmentDidSchema,
  }),
]);
export type JudgmentOp = z.infer<typeof JudgmentOpSchema>;
export type JudgmentOpKind = JudgmentOp['kind'];

/**
 * 判断 batch。**グラフの `Batch` と同じ形にしてある。**
 *
 * op 単位のレコードにしないのは、(1)「招待して同時に別の誰かを取り消す」のような
 * 複数 op の原子性が要ること、(2) clock を batch が持つのでグラフ側の batch と
 * 同じ規則 (`compareByClockActorId`) で並べられること、による。
 *
 * `sheetId` を持たない — 判断は File 単位であってシート単位ではない。
 * fileId を持たないのもグラフ側と同じで、**rkey が運ぶ** (`v1~<fileId>~…`)。
 */
export const JudgmentBatchSchema = z.object({
  id: BatchIdSchema,
  actor: z.string(),
  clock: z.number().int().nonnegative(),
  /** wall clock (表示用。順序付けには使わない) */
  timestamp: z.number().int().nonnegative(),
  ops: z.array(JudgmentOpSchema).min(1),
});
export type JudgmentBatch = z.infer<typeof JudgmentBatchSchema>;
