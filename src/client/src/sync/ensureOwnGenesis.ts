/**
 * 名簿の起点を後から置き直す (step2 Phase 1)
 *
 * `bootstrapParticipation` は **step1 で作られた File のための移行**で、端末 × DID ごとに
 * 1 回だけ走る。したがって**その後に作られた File には起点を置かない**。File 作成時に
 * 起点を書く経路 (`handleCreate`) を足してもなお、
 *
 *   - 移行が済んだ端末で**ログアウト中に作った** File (DID がまだ無いので書けない)
 *   - 起点を書く経路より前に作られた File
 *
 * は起点を持たないまま残る。起点が無い File では**招待が 1 件残らず
 * `issuerNotParticipating` で捨てられ、名簿は永久に空になる**。しかも捨てられた招待は
 * 一覧に出ない (`rosterRows` が出すのは捨てられた承認だけ) ので、画面には
 * 「招待したのに何も起きない」としか見えない。実際にそうなった (2026-09-03, dev 環境で
 * 2 File)。
 *
 * そこで**名簿を読むたびに、起点が無ければその場で置く**。
 *
 * **べき等である。**genesis の id は fileId と actor から決まるので (`
 * participationGenesisBatch`)、何度走らせても同じレコードに収束する。clock は 0 に
 * 固定されていて誰にも割り当てられないので、**既に書かれた招待より必ず前に来る** —
 * 後から置いても、それまでに書かれた招待がそのまま有効になる。
 *
 * **他人の File には置かない。**起点は「この File を作ったのは自分だ」という主張なので、
 * 確かめずに書いてはならない (`isSolelyOwnedBy`、`bootstrapParticipation` と同じ判定)。
 */

import type { Actor, Batch, FileId, JudgmentBatch } from '@conversensus/shared';
import { didFromActor, participationGenesisBatch } from '@conversensus/shared';
import { isSolelyOwnedBy } from './bootstrapParticipation';

export type EnsureOwnGenesisDeps = {
  /** ローカル正典の batch を読む。「本当に自分の File か」の判定に使う */
  fetchBatches: (fileId: FileId) => Promise<Batch[]>;
  /** 判断 batch を自分の repo へ書く */
  putJudgment: (fileId: FileId, batch: JudgmentBatch) => Promise<void>;
  /** この端末の actor (`<did>#<deviceId>`) */
  actor: Actor;
};

/** その判断ログに起点があるか。**どの repo のものでもよい** — 起点は File に 1 つである */
export function hasGenesis(batches: readonly JudgmentBatch[]): boolean {
  return batches.some((batch) =>
    batch.ops.some((op) => op.kind === 'participation.genesis'),
  );
}

/**
 * 起点が無ければ置く。置いたら `true` (呼び出し側は名簿を読み直す)。
 *
 * `known` はいま読んだ判断ログである。**ここで読み直さない** — 名簿の読み出しが
 * 既に全 repo 分を持っているので、二重に読むと増えた分とずれる。
 */
export async function ensureOwnGenesis(
  deps: EnsureOwnGenesisDeps,
  fileId: FileId,
  known: readonly JudgmentBatch[],
): Promise<boolean> {
  if (hasGenesis(known)) return false;
  if (
    !isSolelyOwnedBy(await deps.fetchBatches(fileId), didFromActor(deps.actor))
  )
    return false;
  await deps.putJudgment(fileId, participationGenesisBatch(fileId, deps.actor));
  console.info(`[participation] ${fileId}: 起点が無かったので置いた`);
  return true;
}
