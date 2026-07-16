/**
 * クライアント設定フラグ (step1 W3d)
 */

/**
 * W3d dual-read 安全弁 (§3.4): trunk ファイルの読み取りを op-log 正典
 * (`fetchBatches`→`projectFile`) から行うか。
 *
 * - 既定 `true`: op-log を読み取り正典にする (W3d cutover)。
 * - `VITE_READ_FROM_OPLOG=false` で従来の snapshot 読取へ即時退行できる。
 *   マージ後の実機検証中に退行が出たら flag off で戻す。snapshot は dual-write
 *   で維持されるため、off に戻した snapshot は常に最新 (安全弁が「戻せる」を担保)。
 */
export const READ_FROM_OPLOG =
  (import.meta.env.VITE_READ_FROM_OPLOG ?? 'true') !== 'false';
