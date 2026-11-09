/**
 * 開いている File の参加者 (agent 段 4 R4)。依頼の宛先の候補になる。
 *
 * 名簿は DID で持ち、画面にはハンドル名を出す (`handleLabels`)。招待ダイアログの名簿
 * (`useParticipation`) は開いている間だけのもので、閉じると捨てるので、ここは別に読む。
 * 名簿の供給元は同期サイクルと同じもの (`roster`) を受ける — 別に作ると読みが畳まれない。
 *
 * 読めなければ空 (宛先は選べないが、不特定で送ることはできる)。**ログインしていなければ読まない** —
 * 名簿を読むと起点が無いときに置こうとする (`rosterSource`) ので、PDS に書けない間は触らない。
 * 参加者のいない端末だけの File では、宛先の候補は無い。
 */

import type { Did, FileId } from '@conversensus/shared';
import { useEffect, useState } from 'react';
import { handleLabels } from '../atproto/identity';
import type { RosterSource } from '../sync/rosterSource';

/** 宛先の候補 1 人 */
export type Participant = { did: Did; label: string };

const NONE: readonly Participant[] = [];

export function useFileParticipants(
  fileId: FileId | null,
  roster: RosterSource | null,
  signedIn: boolean,
): readonly Participant[] {
  const [participants, setParticipants] = useState<{
    fileId: FileId;
    list: readonly Participant[];
  } | null>(null);

  useEffect(() => {
    if (fileId === null || roster === null || !signedIn) return;
    let cancelled = false;
    roster
      .read(fileId)
      .then(async ({ participation }) => {
        const dids = [...participation.participating];
        const labelOf = await handleLabels.resolve(dids);
        const list = dids
          .map((did) => ({ did, label: labelOf(did) }))
          .sort((a, b) => a.label.localeCompare(b.label));
        if (!cancelled) setParticipants({ fileId, list });
      })
      .catch((error) =>
        console.warn('[request] 宛先の候補 (名簿) を読めなかった:', error),
      );
    return () => {
      cancelled = true;
    };
  }, [fileId, roster, signedIn]);

  // 別の File の候補を出さない (読み直しが終わるまで空)
  return participants?.fileId === fileId ? participants.list : NONE;
}
