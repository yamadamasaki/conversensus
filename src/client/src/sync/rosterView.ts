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
import { hasEverParticipated } from '@conversensus/shared';

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

/**
 * 行に対して取れる操作。
 *
 * `revoke` は**依頼の取り消しと参加の取り消しを兼ねる** — 仕様が「承認の前後を問わず,
 * 同じ取り消しとして扱う」と定めているので op は 1 つしかない。画面の文言だけが
 * 状態によって変わる (`actionLabel`)。
 */
export type RosterAction =
  | 'preview'
  | 'accept'
  | 'revoke'
  | 'resign'
  | 'reinvite';

export type RosterRow = {
  did: Did;
  /** 依頼した actor。genesis (作成者) と invalid には無い */
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
  for (const [did, reason] of participation.departed) {
    // **依頼のまま取り消された人は, 参加歴が無ければ一覧に出さない** (仕様:
    // 「その依頼はなかったものとする」)。名簿に一度も載ったことが無い人を
    // 「離脱中」として並べると, 依頼を取り消すたびに一覧が伸びていく
    if (!hasEverParticipated(participation, did)) continue;
    put(did, reason === 'revoked' ? 'revoked' : 'resigned');
  }

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

/**
 * 一覧に出る DID をすべて集める (自分の DID と依頼者の DID)。
 *
 * **行から集める。**名簿から集め直すと、行を組む条件と食い違ったときに
 * 「表には出ているのに名前が引かれていない」DID が生まれる。
 */
export function rosterDids(rows: readonly RosterRow[]): Did[] {
  const dids: Did[] = [];
  for (const row of rows) {
    dids.push(row.did);
    if (row.inviter) dids.push(row.inviter);
  }
  return dids;
}

/**
 * ハンドル名で並べ替える (仕様の「参加者のハンドル名のアルファベットでソート」)。
 *
 * **並べ替えは名前を引いた後にしかできない。**`rosterRows` が DID 順で返すのは、
 * 名前が引けるまでの間も順序が決まっている必要があるからである (引けなかった DID は
 * `labelOf` が DID をそのまま返すので、その行だけ DID で並ぶ)。
 */
export function sortRowsByLabel(
  rows: readonly RosterRow[],
  labelOf: (did: Did) => string,
): RosterRow[] {
  return [...rows].sort((a, b) => labelOf(a.did).localeCompare(labelOf(b.did)));
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

  // 自分の行: 依頼されていれば覗いて承認でき、参加していれば降りられる。
  // **離脱した自分を自分で呼び戻すことはできない** — 参加者でなければ依頼を出せない
  if (isSelf) {
    if (status === 'sent') return ['preview', 'accept'];
    if (status === 'accepted') return ['resign'];
    return [];
  }

  // 他人の行: 参加者だけが操作できる。pre 条件と同じ条件である —
  // 押せてしまって畳み込みで捨てられるより、押せない方がよい
  if (!viewerParticipates) return [];
  if (status === 'sent' || status === 'accepted') return ['revoke'];
  // 離脱した人はもう一度呼べる。畳み込みは既にこれを許している
  // (`invite` の pre は「対象が参加者でないこと」であって「未依頼」ではない)
  if (status === 'revoked' || status === 'resigned') return ['reinvite'];
  return [];
}

/**
 * 操作の文言。**状態によって変わる。**
 *
 * `revoke` は依頼の取り消しと参加の取り消しを兼ねるので、同じ op でも
 * 「依頼キャンセル」と「参加取りやめ」に見え分かれる (仕様の操作一覧)。
 * `resign` が `revoke` と同じ文言なのは、仕様が「自分で辞めたか, 辞めさせられたかは
 * 問わない」としているためで、**誰がやったかは参加履歴に出る**。
 */
export function actionLabel(
  action: RosterAction,
  status: RosterStatus,
): string {
  switch (action) {
    case 'preview':
      return '中身を見る';
    case 'accept':
      return '承認';
    case 'resign':
      return '参加取りやめ';
    case 'reinvite':
      return '再度参加依頼';
    case 'revoke':
      return status === 'sent' ? '依頼キャンセル' : '参加取りやめ';
  }
}
