/**
 * deps を差分で送る (D1, 計画 `deepse/plans/refine-d1-deps-delta.md`)
 *
 * batch の deps (書いた時点の因果の知識) は、知っている全 actor の項目を持つので、参加者と端末の累計に
 * 比例して大きくなる。2 人の開発環境でも batch の 3〜4 割が deps だった (計画 F1)。
 *
 * そこで PDS へ送るときだけ、**同じ File の、同じ actor のこの端末が送れた前の batch** を基にした差分にする
 * (`depsBase` = 基の seq)。受け手は取得したレコードを actor ごとに seq の順に畳んで全体に戻す。手元の正典・
 * 畳み込み・因果の判定は全体の deps のままである (計画 F4)。
 *
 * deps は actor ごとに減らない (知識は増えるだけ) ので、差分 = 基より大きい項目、全体 = `join(基, 差分)` で戻る。
 */

import {
  type Actor,
  type FileId,
  joinVectors,
  type VersionVector,
} from '@conversensus/shared';

/** 全体のうち、基より大きい項目だけ */
export function deltaDeps(
  full: VersionVector,
  base: VersionVector,
): VersionVector {
  const out: Record<Actor, number> = {};
  for (const [actor, seq] of Object.entries(full)) {
    if (seq > (base[actor] ?? 0)) out[actor] = seq;
  }
  return out;
}

/** 送るときの deps の形。`depsBase` が有れば `deps` は差分 */
export type EncodedDeps = { deps: VersionVector; depsBase?: number };

/**
 * 送る側の覚え。File × actor ごとに「この端末が**送れた**最後の batch の seq と全体の deps」を持つ。
 *
 * **基は送れた batch に限る** (計画 F3)。送れずに飛ばした batch を基にすると、受け手は基を持たず全体に
 * 戻せない。覚えはこのインスタンスの中だけにあり、起動して最初の 1 件は全体を送る
 */
export class DepsDeltaEncoder {
  private readonly sent = new Map<
    string,
    { seq: number; deps: VersionVector }
  >();

  private keyOf(fileId: FileId, actor: Actor): string {
    return `${fileId}\u0000${actor}`;
  }

  /** 送る形を求める。基が無い (まだ送れていない) か、基が自分より後なら全体 */
  encode(
    fileId: FileId,
    batch: { actor: Actor; seq: number; deps: VersionVector },
  ): EncodedDeps {
    const base = this.sent.get(this.keyOf(fileId, batch.actor));
    if (!base || base.seq >= batch.seq) return { deps: batch.deps };
    return { deps: deltaDeps(batch.deps, base.deps), depsBase: base.seq };
  }

  /** 送れた。以後の基にする (後から前の seq を送り直したときは基を戻さない) */
  confirm(
    fileId: FileId,
    batch: { actor: Actor; seq: number; deps: VersionVector },
  ): void {
    const key = this.keyOf(fileId, batch.actor);
    const current = this.sent.get(key);
    if (current && current.seq >= batch.seq) return;
    this.sent.set(key, { seq: batch.seq, deps: batch.deps });
  }
}

/** 受けたときの形。`depsBase` が有れば `deps` は差分 */
export type DepsCarrier = {
  actor: Actor;
  seq: number;
  deps: VersionVector;
  depsBase?: number;
};

/**
 * 取得したもの (1 File 分) の deps を全体に戻す。actor ごとに seq の順に畳み、差分は基の全体に足す。
 *
 * **基が取得の中に無いものは戻さずに返す** (`unresolved`)。受信は毎回その File の先頭から読むので、基が届けば
 * 次の回に戻る。基を欠いたまま差分を全体として扱うと、知識を少なく見積もった deps が手元の正典に残り続ける
 */
export function restoreDeps<T extends DepsCarrier>(
  items: readonly T[],
): { restored: T[]; unresolved: T[] } {
  const byActor = new Map<Actor, T[]>();
  for (const item of items) {
    const list = byActor.get(item.actor) ?? [];
    list.push(item);
    byActor.set(item.actor, list);
  }
  const restored: T[] = [];
  const unresolved: T[] = [];
  for (const list of byActor.values()) {
    const fullBySeq = new Map<number, VersionVector>();
    for (const item of [...list].sort((a, b) => a.seq - b.seq)) {
      if (item.depsBase === undefined) {
        fullBySeq.set(item.seq, item.deps);
        restored.push(item);
        continue;
      }
      const base = fullBySeq.get(item.depsBase);
      if (base === undefined) {
        unresolved.push(item);
        continue;
      }
      const full = joinVectors(base, item.deps);
      fullBySeq.set(item.seq, full);
      const { depsBase: _base, ...rest } = item;
      restored.push({ ...rest, deps: full } as T);
    }
  }
  return { restored, unresolved };
}
