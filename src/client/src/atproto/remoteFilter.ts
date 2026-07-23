/**
 * remote leg のフィルタ (step1 W3d5-2, Phase 4e-0 で C1 見直し)
 *
 * ローカル正典 (daemon op-log) には全 batch をそのまま流す一方、ATProto (remote) へ
 * push する batch は presentation 除外フィルタを通す (設計 §3.2)。ローカル正典を
 * 一切変えない**純関数**として実装し、`RemoteSyncQueue` の enqueue から呼ぶ。
 *
 *   - presentation 除外 (§3.2・D7): batch の ops を `isSyncable` で絞る。
 *     presentation (node.setStyle / edge.setStyle / edge.setLabelOffset) はローカル
 *     限定で、remote には載せない (再導出可能)。
 *   - genesis batch は **remote へ通す** (Phase 4e-0・C1 見直し, 4e 設計 §3.1)。
 *     Phase 4d で受信経路ができたため、旧 C1 (受信経路が無い間の genesis 衝突防止)
 *     の前提が消えた。genesis の id は ops 内容のみの content-addressed
 *     (actor/timestamp/clock を含まない) なので、同一 snapshot から genesis した
 *     端末間では受信側の (file_id, batch_id) べき等 dedup で吸収され、未知端末には
 *     bootstrap の起源として届く。
 *
 * フィルタ後 ops が空になった batch (全 op が presentation) は remote へ送らない。
 */

import { type Batch, isSyncable } from '@conversensus/shared';

/**
 * remote へ push する batch 列を返す (ローカル正典向けの元 batch 列は変えない)。
 *
 * - 各 batch の ops を `isSyncable` で絞り、空になったら除外する。
 * - ops が減った mixed batch は複製し、`id`/`clock`/`timestamp`/`actor`/`sheetId` を
 *   保存する (ローカル batch と `id`・`clock` で対応づけられるようにする)。
 * - ops が減らない batch は元の参照をそのまま返す (不要な複製を避ける)。
 * - 入力の順序を保つ。
 */
export function filterBatchesForRemote(batches: readonly Batch[]): Batch[] {
  const result: Batch[] = [];
  for (const batch of batches) {
    // presentation op を除外 (genesis batch も同様に非 presentation だけ通す)
    const ops = batch.ops.filter(isSyncable);
    // 全 op が presentation だった batch (group/paste 複合含む) は送らない
    if (ops.length === 0) continue;
    // 減っていなければ元の参照、減ったら他フィールド保存の複製
    result.push(ops.length === batch.ops.length ? batch : { ...batch, ops });
  }
  return result;
}
