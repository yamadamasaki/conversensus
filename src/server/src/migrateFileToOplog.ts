/**
 * op-log 読み取り正典化 (W3d-1): snapshot → genesis の lazy migration オーケストレーション
 *
 * 読み取り要求 (GET /files/:id/batches) 時にサーバが呼ぶ。per-file marker が W3 未満なら、
 * snapshot (`storage.ts` の JSON) を入力に genesis batch を生成し、EventStore の原子トランザクション
 * (破棄→genesis→marker) で op-log を正典化する。
 *
 * 方針 (deepse/plans/step1-w3d-read-cutover.md §3.1):
 *   - **snapshot が正典**: genesis 入力は `readFile(id)` (snapshot)。無ければ migration せず現状維持
 *     (op-log が既にあればそれを返し、無ければ空)。破棄の前提「snapshot が正典」を入力の存在で担保する。
 *   - **原子性は EventStore.migrateToOplog に委譲**: 破棄→genesis→marker が 1 SQLite tx。
 *   - **再入べき等**: 事前 marker 検査 (snapshot 読み込みを省く最適化) + tx 内 re-check の二段。
 */

import type { FileId } from '@conversensus/shared';
import { graphFileToBatches } from '@conversensus/shared';
import type { EventStore } from './eventStore';
import { readFile } from './storage';

/** op-log 正典スキーマの初版。marker 不在 or `< W3_SCHEMA_VERSION` を「未 migration」と判定する */
export const W3_SCHEMA_VERSION = 1;

/**
 * ファイルを op-log 正典へ lazy migration する。既に済なら何もしない。
 *
 * @returns migration を実行したら true、既に済 / snapshot 欠損で skip なら false
 */
export async function migrateFileToOplog(
  store: EventStore,
  fileId: FileId,
): Promise<boolean> {
  // 事前検査: 既に正典なら snapshot 読み込みを省いて即 return (tx 内でも再検査する)
  const current = store.getSchemaVersion(fileId);
  if (current !== null && current >= W3_SCHEMA_VERSION) return false;

  // genesis 入力は snapshot。無ければ破棄の前提が崩れるため migration しない (現状維持)
  const snapshot = await readFile(fileId);
  if (!snapshot) return false;

  const genesisBatches = graphFileToBatches(snapshot);
  return store.migrateToOplog(fileId, genesisBatches, W3_SCHEMA_VERSION);
}
