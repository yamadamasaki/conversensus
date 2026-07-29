/**
 * 起動時の一括移行 (step1 Phase 6 p6-0, 設計 §3.1)
 *
 * snapshot を撤去する (p6-5) と `migrateFileToOplog` は genesis の入力を失う。よって
 * 「未 migration の snapshot を全部 op-log にしてから storage.ts を消す」順序が要る。
 * 本モジュールはその前半 — デーモン起動時に `DATA_DIR` の snapshot を全件走査し、
 * 未 migration のものを genesis 化する。
 *
 * 方針:
 *   - **べき等**: 判定は `migrateFileToOplog` の marker 検査に委ねる。2 回目以降は no-op。
 *   - **失敗は 1 ファイル単位で隔離**: 壊れた snapshot が 1 件あっても残りは移行する。
 *     走査に `listSnapshotIds` (中身を読まない) を使うのはこのため。
 *   - **無言にしない**: 失敗は必ず warn する (W3d5-7 の「400 が無言」の反省)。
 *   - **op-log-only ファイルは対象外**: 受信で materialize されたファイル (Phase 4e-2b) は
 *     snapshot を持たないので走査に現れない。触らないことが正しい。
 *
 * **Phase 6 限りの寿命**: 移行済み環境では no-op になるため、次リリースで削除できる。
 */

import type { FileId } from '@conversensus/shared';
import type { EventStore } from './eventStore';
import { migrateFileToOplog } from './migrateFileToOplog';
import { listSnapshotIds } from './storage';

export type MigrateAllResult = {
  /** 走査した snapshot の件数 */
  scanned: number;
  /** 今回 op-log 化したファイル */
  migrated: FileId[];
  /** 既に op-log 正典だったため何もしなかった件数 */
  skipped: number;
  /** 失敗したファイル (残りの移行は続行済み) */
  failed: Array<{ fileId: FileId; error: unknown }>;
  /** 所要時間 (ms)。受入基準 §5-1 の実測値 */
  elapsedMs: number;
};

/**
 * `DATA_DIR` の snapshot を全件走査し、未 migration のものを op-log 正典へ移行する。
 *
 * throw しない — 個々の失敗は `failed` に集めて呼び出し側 (起動処理) へ返す。
 * 1 件の失敗で起動を止めると、残りの健全なファイルまで開けなくなるため。
 */
export async function migrateAllFilesToOplog(
  store: EventStore,
): Promise<MigrateAllResult> {
  const startedAt = performance.now();
  const ids = (await listSnapshotIds()) as FileId[];

  const migrated: FileId[] = [];
  const failed: MigrateAllResult['failed'] = [];
  let skipped = 0;

  for (const fileId of ids) {
    try {
      if (await migrateFileToOplog(store, fileId)) migrated.push(fileId);
      else skipped += 1;
    } catch (error) {
      console.warn(`[migration] ${fileId} の op-log 化に失敗しました:`, error);
      failed.push({ fileId, error });
    }
  }

  return {
    scanned: ids.length,
    migrated,
    skipped,
    failed,
    elapsedMs: performance.now() - startedAt,
  };
}
