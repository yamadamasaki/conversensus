/**
 * 他 actor の repo から File の名前を引く (step2)
 *
 * 参加の承認ダイアログは「alice.test さんが, あなたを ファイル "test file" の対話への
 * 参加を依頼しています」と出す (`deepse/requirements/spec/participation/accept.png`)。
 * 参加コードに載っているのは DID と FileId だけなので、**名前は依頼者の repo から
 * 引くしかない**。
 *
 * ## 読むのは 1 File 分の op-log である
 *
 * 名前は `graph.file` レコードにあると思いたくなるが、**step1 Phase 6 で snapshot を
 * 書く口が無くなった**ので、そのレコードは古い File にしか残っていない。名前は
 * op-log の `file.setName` op にある。
 *
 * `listByFile` は rkey の prefix 範囲取得なので、**repo 全体は読まない** (Phase 7 p7-2)。
 * それでも「名前 1 つのために File 1 つ分の op-log を落とす」ことに変わりはない。
 * 承認は滅多に起きず、承認したらどのみち Phase 2 で同じものを読むので、これで足りる。
 *
 * **repo ごとに別の答えになりうる。**同じ File でも、まだ同期していない repo は
 * 古い名前を持つ。依頼者の repo から引くのが正しい — 依頼した人が見ている名前で
 * 「何に参加するのか」を伝えたいからである。だからキーが `<did>/<fileId>` になる。
 *
 * ## 名簿の外を読むこと
 *
 * 承認する時点で自分はまだ名簿に載っていない。**読む資格は名簿への所属と独立**である
 * (`deepse/architecture/step2.md` §2) ので、これは越権ではない。参加コードの検証も
 * 同じ理由で依頼者の判断ログを読んでいる。
 *
 * **repo 全体の列挙はしない。**それをやると相手の File が全部見える (U6-P1 の宿題)。
 * ここが読むのは「参加コードが名指しした 1 つの File」に限られる。
 */

import type { Batch, Did, FileId } from '@conversensus/shared';
import { compareByClockActorId } from '@conversensus/shared';
import { createLabelCache } from '../display/labelCache';
import { isBatchRecordValue, recordToBatch } from './batchMapper';
import { batchIdFromRkey } from './batchRkey';
import { batches } from './collections';

/** どの repo の File か。**同じ File でも repo によって名前が違いうる** */
export type RemoteFileRef = `${string}/${string}`;

export function remoteFileRef(repo: Did, fileId: FileId): RemoteFileRef {
  return `${repo}/${fileId}`;
}

/** `<did>/<fileId>` を割る。**最後の `/` で割る** — DID には `:` はあるが `/` は無い */
export function splitRef(ref: RemoteFileRef): { repo: Did; fileId: FileId } {
  const at = ref.lastIndexOf('/');
  return {
    repo: ref.slice(0, at) as Did,
    fileId: ref.slice(at + 1) as FileId,
  };
}

/**
 * その File の今の名前を、その repo から引く。引けなければ `null`。
 *順序は `compareByClockActorId` — グラフの projection と同じ全順序で
 * なければ、改名が競合したときに画面と中身が食い違う。
 */
export async function readRemoteFileName(
  repo: Did,
  fileId: FileId,
): Promise<string | null> {
  const records = await batches.listByFile(fileId, { repo });
  const parsed = records.flatMap((record) => {
    const rkey = record.uri.split('/').pop() ?? '';
    const batchId = batchIdFromRkey(rkey);
    if (!batchId || !isBatchRecordValue(record.value)) return [];
    return [recordToBatch(batchId, record.value)];
  });

  return fileNameFromBatches(parsed);
}

/**
 * batch 列から File の今の名前を取り出す。無ければ `null`。
 *
 * **最後の `file.setName` を採る。**改名は op なので、最初の 1 件で止めると古い名前を
 * 出してしまう。順序は `compareByClockActorId` — グラフの projection と同じ全順序で
 * なければ、改名が競合したときに画面と中身が食い違う。
 */
export function fileNameFromBatches(batches: readonly Batch[]): string | null {
  let name: string | null = null;
  for (const batch of [...batches].sort(compareByClockActorId))
    for (const op of batch.ops) if (op.kind === 'file.setName') name = op.name;
  return name;
}

/**
 * FileId → ファイル名。
 *
 * 引けなければ **fileId をそのまま出す** — 「読めなかった」のか「名前が無い」のかを
 * 空欄で潰さない (`labelCache`)。
 */
export const fileNameLabels = createLabelCache<RemoteFileRef>({
  what: 'ファイル名',
  fallback: (ref) => splitRef(ref).fileId,
  fetch: async (refs) => {
    const found = new Map<RemoteFileRef, string>();
    await Promise.all(
      refs.map(async (ref) => {
        const { repo, fileId } = splitRef(ref);
        const name = await readRemoteFileName(repo, fileId);
        if (name) found.set(ref, name);
      }),
    );
    return found;
  },
});
