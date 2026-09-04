/**
 * remote leg のフィルタ (step1 W3d5-2, Phase 4e-0 で C1 見直し, step2 Phase 2 S0)
 *
 * ローカル正典 (daemon op-log) には全 batch をそのまま流す一方、ATProto (remote) へ
 * push する batch はここを通す (設計 §3.2)。ローカル正典を一切変えない**純関数**として
 * 実装し、`RemoteSyncQueue` の enqueue から呼ぶ。
 *
 * 落とす理由は 2 つある。
 *
 *   - **presentation 除外** (§3.2・D7): batch の ops を `isSyncable` で絞る。
 *     presentation (node.setStyle / edge.setStyle / edge.setLabelOffset) はローカル
 *     限定で、remote には載せない (再導出可能)。フィルタ後 ops が空になった batch は送らない。
 *   - **他 actor が書いた batch の除外** (step2 Phase 2 S0): 下記。
 *
 * genesis batch は **remote へ通す** (Phase 4e-0・C1 見直し, 4e 設計 §3.1)。
 * Phase 4d で受信経路ができたため、旧 C1 (受信経路が無い間の genesis 衝突防止) の前提が
 * 消えた。genesis の id は ops 内容のみの content-addressed (actor/timestamp/clock を
 * 含まない) なので、同一 snapshot から genesis した端末間では受信側の
 * (file_id, batch_id) べき等 dedup で吸収され、未知端末には bootstrap の起源として届く。
 *
 * ## ⚠️ remote へ書くのは自分が書いた batch だけである (step2 Phase 2 S0)
 *
 * step1 ではこの制約が要らなかった。ローカル正典に入る batch は**自分の DID の端末が
 * 書いたものだけ**で、その全端末が同じ repo へ push するので、何を積んでも同じ rkey の
 * 上書き (= べき等) にしかならなかった。
 *
 * **Phase 2 で受信が他 actor の batch をローカル正典へ入れる。**`catchUpRemote` は
 * 「ローカル正典にあって remote に無い batch」を積み直すので、その瞬間から
 * **相手の op-log を自分の repo へ複製する経路**になる (Phase 2 設計 事実 A)。
 *
 *   - 各 repo が参加者数分の op-log を持ち、転送量が参加者数の二乗で効く
 *   - 「参加期間の分だけ読む」という約束が費用の面で無意味になる
 *   - 参加を取りやめた actor の op が、取りやめた後も全員の repo に残り続ける
 *
 * → **著者が自分でない batch は remote へ積まない。**判定は `Batch.actor`
 * (`<did>#<deviceId>`) の DID 部分で行う。「どの repo から読んだか」ではなく
 * **「誰が書いたか」**で判定するので、過去に複製されたレコードが PDS に残っていても
 * 結論は変わらない。
 *
 * **genesis はこの判定の対象外である。**`GENESIS_ACTOR` は DID ではなく、genesis batch は
 * 「誰かの判断」ではなく **File の起源**である。content-addressed で受信側が batch id で
 * dedup するので、複数の repo にあっても増殖しない。除外すると、その File を承認しただけの
 * 端末が起源を持たない op-log を作ってしまう。
 */

import {
  type Batch,
  type Did,
  didFromActor,
  GENESIS_ACTOR,
  isSyncable,
} from '@conversensus/shared';

/**
 * remote へ push する batch 列を返す (ローカル正典向けの元 batch 列は変えない)。
 *
 * - **著者が `myDid` でない batch を除外する** (genesis を除く, step2 Phase 2 S0)。
 * - 各 batch の ops を `isSyncable` で絞り、空になったら除外する。
 * - ops が減った mixed batch は複製し、`id`/`clock`/`timestamp`/`actor`/`sheetId` を
 *   保存する (ローカル batch と `id`・`clock` で対応づけられるようにする)。
 * - ops が減らない batch は元の参照をそのまま返す (不要な複製を避ける)。
 * - 入力の順序を保つ。
 *
 * @param myDid この端末がログインしている DID。**省略できない** — 既定値を持たせると、
 *   配線を忘れた瞬間に他 actor の op-log が自分の repo へ流れ出す (`isLocalDid` と同じ判断)
 */
export function filterBatchesForRemote(
  batches: readonly Batch[],
  myDid: Did,
): Batch[] {
  const result: Batch[] = [];
  for (const batch of batches) {
    // 他 actor が書いた batch は送らない (genesis は File の起源なので対象外)
    if (batch.actor !== GENESIS_ACTOR && didFromActor(batch.actor) !== myDid)
      continue;
    // presentation op を除外 (genesis batch も同様に非 presentation だけ通す)
    const ops = batch.ops.filter(isSyncable);
    // 全 op が presentation だった batch (group/paste 複合含む) は送らない
    if (ops.length === 0) continue;
    // 減っていなければ元の参照、減ったら他フィールド保存の複製
    result.push(ops.length === batch.ops.length ? batch : { ...batch, ops });
  }
  return result;
}
