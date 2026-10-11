/**
 * この端末が最後に書いた判断の点を、File ごとに手元に覚える (#261)
 *
 * 判断ログ (参加の承認など) は PDS にだけあり、ローカル正典には載らない。発番器は File を開くと
 * グラフの op-log (ローカル) から復元されるが、判断ログを知るのは**開いてから最初の受信サイクル**
 * である。その間に編集すると、自分が前に書いた判断と同じ点 `(actor, seq)` を振ってしまう
 * (step3 Phase 5 S5-3 で残った窓 1)。相手はその判断を知っただけで「その編集を見た」ことになり、
 * 並行の書き換えが競合ではなく上書きに分類される。
 *
 * 判断を書いたらその点 (seq と clock) をここに覚え、発番器を作るときに読み戻す。**覚えるのは点
 * だけ** — 判断の中身は PDS が正であり、ここは「この seq より後から振れ」という下限にすぎない。
 *
 * actor ごとに分ける。actor はログインで変わる (`local#…` → `<did>#…`) ので、別の actor の点を
 * 下限にしてはならない (seq は actor ごとの連番である)。
 */

import type { Actor, FileId, Lamport, Seq } from '@conversensus/shared';
import { z } from 'zod';
import { safeLocalStorage } from './safeStorage';

const KEY_PREFIX = 'conversensus.ownJudgmentPoint.';

const PointSchema = z.object({
  actor: z.string(),
  seq: z.number().int().nonnegative(),
  clock: z.number().nonnegative(),
});

export type OwnJudgmentPoint = { actor: Actor; seq: Seq; clock: Lamport };

const keyOf = (fileId: FileId) => `${KEY_PREFIX}${fileId}`;

/** 覚えている点を読む。別の actor の点・壊れた値・読めない保存領域は無いものとする */
export function recallOwnJudgmentPoint(
  fileId: FileId,
  actor: Actor,
  storage: Storage | null = safeLocalStorage(),
): OwnJudgmentPoint | null {
  try {
    const raw = storage?.getItem(keyOf(fileId));
    if (!raw) return null;
    const parsed = PointSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.actor !== actor) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/**
 * 書いた点を覚える。**前に覚えた点より小さければ覚え直さない** (同じ actor のとき)。
 * 保存できなくても判断を書くことは止めない — 窓 1 が開くだけで、壊れはしない
 */
export function rememberOwnJudgmentPoint(
  fileId: FileId,
  point: OwnJudgmentPoint,
  storage: Storage | null = safeLocalStorage(),
): void {
  const known = recallOwnJudgmentPoint(fileId, point.actor, storage);
  if (known && known.seq >= point.seq) return;
  try {
    storage?.setItem(keyOf(fileId), JSON.stringify(point));
  } catch (error) {
    console.warn('[causal] 判断の点を覚えられなかった:', error);
  }
}
