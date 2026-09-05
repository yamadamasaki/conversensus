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

import type {
  BatchId,
  Did,
  Participation,
  RejectedJudgment,
  RejectReason,
} from '@conversensus/shared';
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
  | 'reinvite'
  | 'reopen';

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
  // **誰も参加していない = 引き取れる状態である** (step2 Phase 2)。
  // 空の名簿からは招待も起点の置き直しも通らないので、引き取りだけが出口になる
  const rosterEmpty = participation.participating.size === 0;
  const rows = new Map<Did, RosterRow>();

  const put = (did: Did, status: RosterStatus, inviter?: Did) => {
    rows.set(did, {
      did,
      ...(inviter !== undefined && { inviter }),
      status,
      available: actionsFor({
        did,
        status,
        viewer,
        viewerParticipates,
        rosterEmpty,
      }),
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
  rosterEmpty,
}: {
  did: Did;
  status: RosterStatus;
  viewer: Did;
  viewerParticipates: boolean;
  rosterEmpty: boolean;
}): RosterAction[] {
  const isSelf = did === viewer;

  // 自分の行: 依頼されていれば覗いて承認でき、参加していれば降りられる。
  // **離脱した自分を自分で呼び戻すことはできない** — 参加者でなければ依頼を出せない。
  // **ただし誰も参加していないときだけは引き取れる** (step2 Phase 2)。呼び戻せる人が
  // 1 人も残っていない状態で塞ぐと、File が永久に閉じる
  if (isSelf) {
    if (status === 'sent') return ['preview', 'accept'];
    if (status === 'accepted') return ['resign'];
    if (rosterEmpty && (status === 'revoked' || status === 'resigned'))
      return ['reopen'];
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
    case 'reopen':
      return 'この File を引き取る';
    case 'revoke':
      return status === 'sent' ? '依頼キャンセル' : '参加取りやめ';
  }
}

// --- File の共有状態 (step2 Phase 2, 2026-09-05 実機で発覚) ---

/**
 * 見る人から見た File の共有状態。
 *
 * **取り消されても File は手元に残る** — ローカル正典は自分の写しであって、共有が
 * 切れたからといって消す筋合いは無い。しかし止まるのは取り込みであって表示ではないので、
 * **何も出さないと「もう同期されない File」が普通の File に見える** (実機で混乱した)。
 */
export type FileSharing = {
  /** いま参加している actor の数 (自分を含む) */
  participants: number;
  /**
   * 見る人がその 1 人か。
   *
   * `false` は「取り消された / 自分で降りた」を意味する。**ただし名簿が空のときは
   * 意味を持たない** — 起点の無い古い File では誰も参加者にならないので、
   * `participants === 0` と区別すること (`isDetached` がそれを含む)。
   */
  viewerParticipates: boolean;
  /**
   * **共有が切れているか。**名簿に誰かがいて、その中に自分がいない状態だけを指す。
   *
   * 名簿が空 (起点の無い古い File) を含めない。含めると、共有と無関係な File にまで
   * 「同期していません」が出てしまう。
   */
  isDetached: boolean;
};

/** 名簿から、見る人にとっての共有状態を導く */
export function fileSharing(
  participation: Participation,
  viewer: Did,
): FileSharing {
  const participants = participation.participating.size;
  const viewerParticipates = participation.participating.has(viewer);
  return {
    participants,
    viewerParticipates,
    isDetached: participants > 0 && !viewerParticipates,
  };
}

// --- 捨てられた判断の知らせ (step2 Phase 1) ---

/** 判断を捨てた理由を、何が起きたか分かる文にする */
const REJECT_REASON_LABEL: Record<RejectReason, string> = {
  issuerNotParticipating: '発行者が参加者でない',
  issuerNotInvited: '発行者が招待されていない',
  targetNotInRoster: '対象が名簿にいない',
  targetAlreadyParticipating: '対象は既に参加者',
  targetForeignPds: '対象が別の PDS のアカウント',
  duplicateGenesis: '起点が二重',
  rosterNotEmpty: 'まだ参加している人がいる',
  noGenesis: '起点がまだ見えていない',
};

/**
 * **いま書いた batch**のうち捨てられた op の要約。捨てられていなければ `null`。
 *
 * **判断ログ全体の捨てた op を出してはならない** (2026-09-05 実機で発覚)。判断ログは
 * 追記しかされないので、一度捨てられた op は**永久に残る**。全体を数えて出すと、
 * 半年前の打ち間違い 1 件のせいで警告が消えなくなる。実際に消えなくなった。
 *
 * これが伝えたいのは「**いまの操作が効かなかった**」であって、ログの健康診断ではない
 * (診断は `scripts/inspect-judgments.ts` の仕事である)。したがって対象は
 * **書いた本人の、書いたばかりの batch** に限る。名簿を開いただけのときは何も出さない。
 *
 * 理由ごとにまとめる — 同じ理由で 10 件落ちたときに 10 行出しても読めない。
 */
export function describeRejected(
  rejected: readonly RejectedJudgment[],
  wrote: BatchId | undefined,
): string | null {
  if (!wrote) return null;
  const mine = rejected.filter((r) => r.batchId === wrote);
  if (mine.length === 0) return null;
  const counts = new Map<RejectReason, number>();
  for (const r of mine) counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
  const parts = [...counts].map(
    ([reason, n]) => `${n} 件 (${REJECT_REASON_LABEL[reason]})`,
  );
  return `いまの操作は名簿に反映されなかった: ${parts.join(', ')}`;
}
