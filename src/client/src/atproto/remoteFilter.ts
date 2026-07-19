/**
 * remote leg のフィルタ (step1 W3d5-2)
 *
 * ローカル正典 (daemon op-log) には全 batch をそのまま流す一方、ATProto (remote) へ
 * push する batch は 2 段のフィルタを通す (設計 §3.2)。ローカル正典を一切変えない
 * **純関数**として実装し、`FanoutSyncProvider` の remote leg (W3d5-4) から呼ぶ。
 *
 *   1. genesis actor 除外 (§3.5・critic C1): `actor === GENESIS_ACTOR` の batch は
 *      丸ごと落とす。受信 (import) 経路が無い現状で genesis を remote に載せると、
 *      各端末が独立生成する genesis と clock が衝突し remote が汚染されるため。
 *   2. presentation 除外 (§3.2・D7): 残った batch の ops を `isSyncable` で絞る。
 *      presentation (node.setStyle / edge.setStyle / edge.setLabelOffset) はローカル
 *      限定で、remote には載せない (再導出可能)。
 *
 * フィルタ後 ops が空になった batch (全 op が presentation) は remote へ送らない。
 */

import { type Batch, GENESIS_ACTOR, isSyncable } from '@conversensus/shared';

/**
 * remote へ push する batch 列を返す (ローカル正典向けの元 batch 列は変えない)。
 *
 * - genesis actor の batch は除外する。
 * - 各 batch の ops を `isSyncable` で絞り、空になったら除外する。
 * - ops が減った mixed batch は複製し、`id`/`clock`/`timestamp`/`actor`/`sheetId` を
 *   保存する (ローカル batch と `id`・`clock` で対応づけられるようにする)。
 * - ops が減らない batch は元の参照をそのまま返す (不要な複製を避ける)。
 * - 入力の順序を保つ。
 */
export function filterBatchesForRemote(batches: readonly Batch[]): Batch[] {
  const result: Batch[] = [];
  for (const batch of batches) {
    // (1) genesis batch は remote へ載せない (C1: 受信経路が無い間の genesis 衝突防止)
    if (batch.actor === GENESIS_ACTOR) continue;
    // (2) presentation op を除外
    const ops = batch.ops.filter(isSyncable);
    // 全 op が presentation だった batch (group/paste 複合含む) は送らない
    if (ops.length === 0) continue;
    // 減っていなければ元の参照、減ったら他フィールド保存の複製
    result.push(ops.length === batch.ops.length ? batch : { ...batch, ops });
  }
  return result;
}
