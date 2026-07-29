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

// `BRANCH_FROM_OPLOG` (Phase 5 の branch 経路スイッチ) は Phase 6 p6-5b で撤去した。
// 退行先だった旧 PDS 経路 (`branchState.ts` のレコード複製方式) を p6-6 の実機 e2e
// 通過後に退役させたため、倒す先がもう無い (設計 §3.7 / §6.1)。
