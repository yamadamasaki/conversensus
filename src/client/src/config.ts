/**
 * クライアント設定フラグ (step1 W3d)
 */

// `READ_FROM_OPLOG` (W3d dual-read 安全弁) は Phase 6 p6-3 で撤去した。
// 退避先だった snapshot への**書込を止めた**ため、off にしても古い内容を見せるだけの
// スイッチになり安全弁として成立しなくなったため (設計 §3.6 / §4.2)。

/**
 * W3d5 remote 送信の安全弁 (§3.4・§7 で要否を判断 → 設ける): 編集 batch を ATProto へ
 * 送信するか (読取側の安全弁と対になる退行スイッチだった)。
 *
 * - 既定 `true`: ATProto ログイン中のみ remote へ送る (未ログイン時は元から local-only)。
 * - `VITE_SYNC_TO_REMOTE=false`: ログイン中でも送信しない = W3d と完全に同じ local-only 動作。
 *   remote 起因の不具合 (PDS 障害・レート制限・想定外レコード) をログアウトさせずに切り分け・
 *   停止できる。読取と違い送信は**外部に書き込む**ため、止める手段を持つ価値が読取側より高い。
 */
export const SYNC_TO_REMOTE =
  (import.meta.env.VITE_SYNC_TO_REMOTE ?? 'true') !== 'false';

/**
 * step1 Phase 5 の branch 経路スイッチ (設計 §4 p5-4): branch の作成・読取・編集・
 * commit・merge を **op-log** で行うか、旧 `branchState.ts` (PDS レコード複製) で行うか。
 *
 * - 既定 `true`: branch は branch 専用 file_id の op-log を正典にする (Phase 5 cutover)。
 * - `VITE_BRANCH_FROM_OPLOG=false`: 旧 PDS 経路へ丸ごと退行する。読取側にあった
 *   `READ_FROM_OPLOG` と同じ役割の安全弁だが、**両経路のデータは互換ではない** (旧は PDS の
 *   `{branchId}_` prefix レコード、新は local op-log)。off に戻すと op-log 側で作った
 *   branch は見えなくなる (branch は二重に書いていない)。実機で退行が出たときの
 *   緊急避難であって、日常的に
 *   行き来する想定ではない。
 */
export const BRANCH_FROM_OPLOG =
  (import.meta.env.VITE_BRANCH_FROM_OPLOG ?? 'true') !== 'false';
