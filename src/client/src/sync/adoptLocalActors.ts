/**
 * 未ログインで書いた batch を、ログインした人の batch として出し直す (FPR 前 L-1)
 *
 * 設計: `deepse/plans/pre-fpr-local-actor.md`
 *
 * 未ログイン (またはオフラインで起動してログアウト扱いになった間) の編集は actor が
 * `local#<deviceId>` で、送信は自分の DID の batch だけを送るので、そのままでは誰にも届かない。
 * ログインしたら:
 *
 * 1. 未ログインの batch があれば、**送ってよいか訊く** (Q1。同じブラウザを別の人が使っていたときに、
 *    他人の編集を自分の名前で公開しないための安全弁)。断られたら何もしない (次のログインでまた訊く)
 * 2. `local` の actor ごとに、**新しい actor** (`<did>#<新しい id>`) へ付け替える。同じ端末の
 *    `<did>#<deviceId>` は連番がぶつかるので使わない (設計 F5)。clock・seq・中身はそのまま
 * 3. 付け替えた File ごとに catch-up を走らせ、PDS に無い自分の batch として送る (設計 F6)
 */

import {
  type Actor,
  composeActor,
  type Did,
  type FileId,
  type LocalActorBatchCount,
} from '@conversensus/shared';

export type LocalActorBatches = LocalActorBatchCount;

export type AdoptLocalActorsDeps = {
  listLocalActorBatches: () => Promise<LocalActorBatches[]>;
  renameActor: (from: Actor, to: Actor) => Promise<number>;
  /** 付け替え先の actor の端末 id を作る (使われていない新しい id) */
  newDeviceId: () => string;
  /** 送ってよいか訊く。`true` なら出し直す */
  confirm: (summary: {
    batches: number;
    fileIds: FileId[];
    /** 最後の編集の時刻 (ms)。前の人の編集かどうかの手がかり (#288) */
    lastEditedAt: number;
  }) => Promise<boolean>;
  /** その File の手元の batch を、PDS に無いものだけ送る */
  catchUp: (fileId: FileId) => Promise<void>;
};

export type AdoptLocalActorsResult =
  | { status: 'none' }
  | { status: 'declined'; batches: number }
  | { status: 'adopted'; batches: number; fileIds: FileId[] };

export async function adoptLocalActors(
  did: Did,
  deps: AdoptLocalActorsDeps,
): Promise<AdoptLocalActorsResult> {
  const rows = await deps.listLocalActorBatches();
  if (rows.length === 0) return { status: 'none' };

  const batches = rows.reduce((sum, row) => sum + row.count, 0);
  const fileIds = [...new Set(rows.map((row) => row.fileId))];
  const lastEditedAt = Math.max(...rows.map((row) => row.lastTimestamp));
  if (!(await deps.confirm({ batches, fileIds, lastEditedAt }))) {
    return { status: 'declined', batches };
  }

  for (const from of new Set(rows.map((row) => row.actor))) {
    await deps.renameActor(from, composeActor(did, deps.newDeviceId()));
  }
  for (const fileId of fileIds) {
    // 送れなくても付け替えは済んでいる。次の catch-up (起動時・online・今すぐ同期) が送る
    await deps.catchUp(fileId).catch((error: unknown) => {
      console.warn(
        '[adopt] catch-up failed; will retry on the next sync',
        error,
      );
    });
  }
  return { status: 'adopted', batches, fileIds };
}
