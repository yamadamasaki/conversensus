/**
 * 開いている File の参加者 (agent 段 4 R4)。依頼の宛先の候補になる。
 *
 * 名簿は DID で持ち、画面にはハンドル名を出す (`handleLabels`)。
 *
 * **名簿は自分で読まず、同期サイクルが読んだものを受け取る** (#381)。以前は File を開いたときに
 * 1 度だけ読んでいたので、開いた後で参加した人は開き直すまで候補に出なかった。同期サイクルは
 * 毎回名簿を読むので、その結果を受ければ次のサイクルで追いつく (共有状態 `sharing` と同じ受け方。
 * 表示のために読み直すとリクエストが倍になる)。
 *
 * 名簿がまだ届いていない・ログインしていない・参加者のいない端末だけの File では、候補は無い
 * (宛先は選べないが、不特定で送ることはできる)。
 */

import type { Did, FileId } from '@conversensus/shared';
import { useEffect, useState } from 'react';
import { handleLabels } from '../atproto/identity';

/** 宛先の候補 1 人 */
export type Participant = { did: Did; label: string };

/** 同期サイクルが読んだ、ある File の参加者の DID */
export type ParticipatingDids = { fileId: FileId; dids: readonly Did[] };

const NONE: readonly Participant[] = [];

/** DID からハンドル名を引く口。既定は `handleLabels` (テストは差し替える) */
type ResolveLabels = (dids: readonly Did[]) => Promise<(did: Did) => string>;

export function useFileParticipants(
  fileId: FileId | null,
  participating: ParticipatingDids | null,
  resolveLabels: ResolveLabels = handleLabels.resolve,
): readonly Participant[] {
  const [participants, setParticipants] = useState<{
    source: ParticipatingDids;
    list: readonly Participant[];
  } | null>(null);

  useEffect(() => {
    if (participating === null) return;
    let cancelled = false;
    const { dids } = participating;
    resolveLabels(dids)
      .then((labelOf) => {
        const list = dids
          .map((did) => ({ did, label: labelOf(did) }))
          .sort((a, b) => a.label.localeCompare(b.label));
        if (!cancelled) setParticipants({ source: participating, list });
      })
      .catch((error) =>
        console.warn('[request] 宛先の候補のハンドル名を引けなかった:', error),
      );
    return () => {
      cancelled = true;
    };
  }, [participating, resolveLabels]);

  // 別の File の候補を出さない。名が引けるまでは前の候補を出し続ける (人が増えた直後に空にしない)
  return participants?.source.fileId === fileId && fileId !== null
    ? participants.list
    : NONE;
}
