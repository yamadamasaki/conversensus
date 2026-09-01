/**
 * 名簿を UI の一覧に整形する (step2 Phase 1)
 *
 * 仕様: `deepse/requirements/spec/participation.md`「UI の例」
 *
 * 仕様が求めるのは「invite されているアクタと invite しているアクタ, 参加コード, 状態,
 * action の表」である。**状態と action は名簿そのものではなく、名簿を見る人の立場に
 * よって決まる** — 同じ行でも、自分の行なら承認でき、他人の行なら取り消せる。
 * その導出をここに閉じて、コンポーネントは表を描くだけにする。
 */

import type { Did, Participation } from '@conversensus/shared';

/**
 * 一覧に出す状態 (仕様の UI 例)。
 *
 * `invalid` だけが名簿の**外**から来る — 招待されていない actor の承認は畳み込みで
 * 捨てられるので、`participating` にも `invited` にも現れない。捨てた op と理由を
 * `rejected` として返しているのは、この 1 行を出すためである。
 */
export type RosterStatus =
  | 'sent'
  | 'accepted'
  | 'revoked'
  | 'resigned'
  | 'invalid';

/** 仕様の UI 例が挙げる action */
export type RosterAction = 'preview' | 'accept' | 'revoke' | 'resign';

export type RosterRow = {
  did: Did;
  /** 招待した actor。genesis (作成者) と invalid には無い */
  inviter?: Did;
  status: RosterStatus;
  /** **この行に対して viewer が取れる操作。**それ以外はグレイアウトする */
  available: RosterAction[];
};

/**
 * 名簿を一覧の行に変換する。
 *
 * `viewer` は「この画面を見ている人」の DID である。仕様の「立場によってグレイアウト」を
 * 成立させるために要る。
 */
export function rosterRows(
  participation: Participation,
  viewer: Did,
): RosterRow[] {
  const viewerParticipates = participation.participating.has(viewer);
  const rows = new Map<Did, RosterRow>();

  const put = (did: Did, status: RosterStatus, inviter?: Did) => {
    rows.set(did, {
      did,
      ...(inviter !== undefined && { inviter }),
      status,
      available: actionsFor({ did, status, viewer, viewerParticipates }),
    });
  };

  for (const did of participation.participating) put(did, 'accepted');
  for (const [did, inviter] of participation.invited) put(did, 'sent', inviter);
  for (const [did, reason] of participation.departed)
    put(did, reason === 'revoked' ? 'revoked' : 'resigned');

  // **捨てられた承認だけを invalid として足す。**他の理由 (他 PDS への招待など) は
  // 相手が一覧に載る筋合いが無い — 名簿に関わったことが一度も無いからである。
  // 承認だけは「その人が参加しようとした」という事実が本人にも招待者にも見えるべき
  for (const rejected of participation.rejected) {
    if (rejected.op.kind !== 'participation.accept') continue;
    if (rejected.reason !== 'issuerNotInvited') continue;
    const did = didOf(rejected.actor);
    if (rows.has(did)) continue; // 後から正規に招待された行を上書きしない
    put(did, 'invalid');
  }

  return [...rows.values()].sort((a, b) => a.did.localeCompare(b.did));
}

/** actor (`<did>#<deviceId>`) から DID を取り出す。名簿は DID 単位である */
function didOf(actor: string): Did {
  return actor.split('#')[0] ?? actor;
}

function actionsFor({
  did,
  status,
  viewer,
  viewerParticipates,
}: {
  did: Did;
  status: RosterStatus;
  viewer: Did;
  viewerParticipates: boolean;
}): RosterAction[] {
  const isSelf = did === viewer;

  // 自分の行: 招待されていれば覗いて承認でき、参加していれば降りられる
  if (isSelf) {
    if (status === 'sent') return ['preview', 'accept'];
    if (status === 'accepted') return ['resign'];
    return [];
  }

  // 他人の行: 参加者だけが取り消せる。pre 条件と同じ条件である —
  // 押せてしまって畳み込みで捨てられるより、押せない方がよい
  if (!viewerParticipates) return [];
  if (status === 'sent' || status === 'accepted') return ['revoke'];
  return [];
}
