/**
 * 未ログインで書いた batch を、ログインした人の batch として出し直す (FPR 前 L-1)
 *
 * 設計: `deepse/plans/pre-fpr-local-actor.md`
 *
 * 未ログイン (またはオフラインで起動してログアウト扱いになった間) の編集は actor が
 * `local#<deviceId>` で、送信は自分の DID の batch だけを送るので、そのままでは誰にも届かない。
 * ログインしたら:
 *
 * 1. 未ログインの batch がある File と、未ログインで作った File (`pending`) があれば、**送ってよいか
 *    訊く** (Q1。同じブラウザを別の人が使っていたときに、他人の編集を自分の名前で公開しないための
 *    安全弁)。断られたら、その File を**丸ごとこの端末に留める** (`declined`, #253) — genesis も
 *    ログインした後の編集も送らない。次のログインでは訊かない (File の詳細から後で送れる)
 * 2. `local` の actor ごとに、**新しい actor** (`<did>#<新しい id>`) へ付け替える。同じ端末の
 *    `<did>#<deviceId>` は連番がぶつかるので使わない (設計 F5)。clock・seq・中身はそのまま
 * 3. 「この端末だけ」の印を外し (branch ごと)、File ごとに catch-up を走らせ、PDS に無い自分の
 *    batch として送る (設計 F6)
 */

import {
  type Actor,
  composeActor,
  type Did,
  type FileId,
  type LocalActorBatchCount,
} from '@conversensus/shared';
import type { LocalOnlyFiles } from './localOnlyFiles';

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
    /** 最後の編集の時刻 (ms)。前の人の編集かどうかの手がかり (#288)。編集が無ければ省く */
    lastEditedAt?: number;
  }) => Promise<boolean>;
  /** その File の手元の batch を、PDS に無いものだけ送る */
  catchUp: (fileId: FileId) => Promise<void>;
  /** この端末だけの File の印 (#253) */
  localOnly: () => LocalOnlyFiles;
  /** 印を外す (branch ごと)。外した file id を返す */
  release: (fileId: FileId) => FileId[];
  /** 「送らない」と答えた File に印を付ける */
  decline: (fileIds: readonly FileId[]) => void;
};

export type AdoptLocalActorsResult =
  | { status: 'none' }
  | { status: 'declined'; batches: number }
  | { status: 'adopted'; batches: number; fileIds: FileId[] };

export async function adoptLocalActors(
  did: Did,
  deps: AdoptLocalActorsDeps,
): Promise<AdoptLocalActorsResult> {
  const allRows = await deps.listLocalActorBatches();
  const marks = deps.localOnly();
  // branch の op-log は別の file id を持つ。印があれば元の File に寄せて訊く
  const trunkOf = (fileId: FileId) => marks.get(fileId)?.trunk ?? fileId;
  const declined = (fileId: FileId) =>
    marks.get(trunkOf(fileId))?.state === 'declined';
  // 前に「送らない」と答えた File は訊き直さない (#253)
  const rows = allRows.filter((row) => !declined(row.fileId));
  const pending = [...marks]
    .filter(([, entry]) => entry.state === 'pending' && !entry.trunk)
    .map(([id]) => id);
  const fileIds = [
    ...new Set([...rows.map((row) => trunkOf(row.fileId)), ...pending]),
  ];
  if (fileIds.length === 0) return { status: 'none' };

  const batches = rows.reduce((sum, row) => sum + row.count, 0);
  const lastEditedAt =
    rows.length > 0
      ? Math.max(...rows.map((row) => row.lastTimestamp))
      : undefined;
  if (!(await deps.confirm({ batches, fileIds, lastEditedAt }))) {
    deps.decline(fileIds);
    return { status: 'declined', batches };
  }

  // 付け替えは保存全体に効く (同じ actor が「送らない」と答えた File にも書いていれば、そこも
  // 付け替わる)。その File は印があるので送られず、手元の姿も変わらない
  for (const from of new Set(rows.map((row) => row.actor))) {
    await deps.renameActor(from, composeActor(did, deps.newDeviceId()));
  }
  const targets = new Set<FileId>(rows.map((row) => row.fileId));
  for (const fileId of fileIds) {
    targets.add(fileId);
    for (const released of deps.release(fileId)) targets.add(released);
  }
  for (const fileId of targets) {
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
