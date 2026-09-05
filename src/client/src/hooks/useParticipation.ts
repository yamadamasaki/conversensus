/**
 * 名簿の操作をまとめる (step2 Phase 1)
 *
 * 読み出し (`readRoster`)、整形 (`rosterRows`)、書き込み (`appendJudgment`) を繋いで、
 * ダイアログが押せる形にする。
 *
 * **範囲は名簿までである。**承認しても**グラフの中身は同期しない** — 他 actor の
 * op-log を読むのは Phase 2 (多アクタ同期) の仕事で、そこは「名簿を先に読み、グラフを
 * 後に読む」の後半にあたる。Phase 1 の完了基準は「招待 → 承認で名簿に載り、取消で外れる」
 * であって、相手のグラフが見えることではない。
 *
 * **名簿の読み方はここには無い** (step2 Phase 2 S1)。起点を自分にすること・起点が無ければ
 * 置いて読み直すことは `rosterSource` が持ち、同期サイクルと共有する。読み方が 2 箇所に
 * 分かれると、片方だけが起点を修復するような食い違いが生まれる。
 */

import type {
  Actor,
  BatchId,
  Did,
  FileId,
  JudgmentBatch,
  JudgmentOp,
  ParticipationEvent,
  RejectedJudgment,
  RejectReason,
} from '@conversensus/shared';
import { didFromActor } from '@conversensus/shared';
import { useCallback, useRef, useState } from 'react';
import {
  handleLabels,
  isDidOnThisPds,
  resolveHandle,
} from '../atproto/identity';
import { loadRoster, putJudgment } from '../atproto/judgmentStore';
import { fileNameLabels, remoteFileRef } from '../atproto/remoteFileName';
import type { LabelResolver } from '../display/labelCache';
import { appendJudgment } from '../sync/appendJudgment';
import type { DecodeFailure } from '../sync/participationCode';
import {
  decodeParticipationCode,
  encodeParticipationCode,
} from '../sync/participationCode';
import { planInvitations } from '../sync/planInvitations';
import type { RosterSource } from '../sync/rosterSource';
import type { RosterAction, RosterRow } from '../sync/rosterView';
import { rosterDids, rosterRows, sortRowsByLabel } from '../sync/rosterView';
import type { TapClock } from './useEventSyncTap';

export type ParticipationState = {
  rows: RosterRow[];
  /** 読めなかった repo。名簿が欠けている可能性を画面に出すために持つ */
  unreadable: Did[];
  /**
   * 畳み込みが捨てた判断の要約。**空でなければ画面に出す。**
   *
   * 捨てられた承認は `invalid` の行になるが、**捨てられた招待は行を持たない** —
   * 招待された人は名簿のどこにも現れないからである。理由を出さないと
   * 「招待したのに表が空のまま」が原因不明のまま残る (2026-09-03 に実際に起きた)。
   */
  rejectedNote: string | null;
  /**
   * DID → ハンドル名。**名簿が持つのは DID、画面に出すのはハンドル名**である。
   * 引けなかった DID は DID のまま返る (`labelCache`)
   */
  labelOf: LabelResolver<Did>;
  /**
   * DID ごとの出来事の列。参加履歴ダイアログが使う。
   *
   * **畳み込みが返したものをそのまま持つ。**生の判断ログから画面側で組み直すと、
   * pre 条件で捨てられた依頼や取り消しまで履歴に出てしまう
   */
  history: ReadonlyMap<Did, readonly ParticipationEvent[]>;
  /**
   * 参加コードを検めた結果。**承認の前に「何に参加するのか」を見せるために持つ**
   * (仕様の承認ダイアログ)。`null` ならまだコードを入れる段である
   */
  preview: InvitationPreview | null;
  /** 今わかっている判断ログ。**clock の seed に使うので捨ててはならない** */
  known: JudgmentBatch[];
  busy: boolean;
  error: string | null;
};

const EMPTY: ParticipationState = {
  rows: [],
  unreadable: [],
  rejectedNote: null,
  labelOf: (did) => did,
  history: new Map(),
  preview: null,
  known: [],
  busy: false,
  error: null,
};

/**
 * 参加コードが指すものを、人に見せる形にしたもの。
 *
 * **DID も FileId も出さない。**「誰が」「あなたを」「どのファイルに」誘っているかが
 * 分からなければ、承認してよいかを判断できない。
 */
export type InvitationPreview = {
  fileId: FileId;
  inviter: Did;
  /** 依頼者のハンドル名 */
  inviterLabel: string;
  /** 自分のハンドル名。**コードが自分宛であることを目で確かめられる** */
  inviteeLabel: string;
  /** File の名前。依頼者の repo から引く */
  fileName: string;
};

export type UseParticipationDeps = {
  actor: Actor;
  /**
   * **開いている File のグラフと同じ clock。**独立した採番器を渡してはならない。
   *
   * clock 空間は File ごとなので、**判断を書く File が開いているときにだけ使う**
   * (`activeFileId` で判定する)。承認は「まだ手元に無い File」に対して行うので、
   * ここを無条件に使うと**別の clock 空間の採番器で発番**することになり、しかも
   * 開いていなければ `tick()` が落ちる (2026-09-05 実機で発覚)。
   */
  clock: TapClock;
  /** いま開いている File。`clock` を使ってよいかの判定に使う */
  activeFileId: FileId | null;
  /**
   * 名簿の供給元 (step2 Phase 2 S1)。**同期サイクルと同じものを渡す** —
   * 別に作ると読みが畳まれず、起点の修復も二重に走る
   */
  roster: RosterSource;
  newBatchId?: () => BatchId;
};

export function useParticipation({
  actor,
  clock,
  activeFileId,
  roster,
  newBatchId = () => crypto.randomUUID() as BatchId,
}: UseParticipationDeps) {
  const [state, setState] = useState<ParticipationState>(EMPTY);
  /**
   * 最新の判断ログ。**state と別に ref でも持つ** — `write` は非同期なので、
   * レンダー時の state を閉じ込めると 1 世代古い `known` で clock を seed してしまう。
   * 古いと seed が足りず、判断ログの clock が衝突する
   */
  const knownRef = useRef<JudgmentBatch[]>([]);
  const viewer = didFromActor(actor);

  /**
   * 名簿を読み直して整形する。読み方 (起点・起点の修復) は `rosterSource` が持つ。
   *
   * @param fresh 判断ログを書いた直後は `true`。進行中の読みに相乗りすると
   *   書く前の名簿が返り、「依頼したのに表に出ない」になる
   */
  const refresh = useCallback(
    async (fileId: FileId, fresh = false) => {
      setState((s) => ({ ...s, busy: true, error: null }));
      try {
        const result = fresh
          ? await roster.readFresh(fileId)
          : await roster.read(fileId);
        knownRef.current = result.batches;
        // **描画の前にまとめて名前を引き、描画には同期の関数だけを渡す**
        // (`labelCache`)。行ごとに待つと表がちらつき、失敗の扱いが行ごとにばらける
        const rows = rosterRows(result.participation, viewer);
        const labelOf = await handleLabels.resolve(rosterDids(rows));
        setState({
          rows: sortRowsByLabel(rows, labelOf),
          unreadable: result.unreadable.map((u) => u.did),
          rejectedNote: describeRejected(result.participation.rejected),
          labelOf,
          history: result.participation.history,
          // 名簿を読み直したら検め中の依頼は畳む。承認の後に `refresh` が走るので、
          // ここが残ると承認済のコードの確認画面が出たままになる
          preview: null,
          known: result.batches,
          busy: false,
          error: null,
        });
      } catch (error) {
        setState((s) => ({ ...s, busy: false, error: describe(error) }));
      }
    },
    [viewer, roster],
  );

  /** @returns 書けたら true。**失敗を握り潰さない** — 呼び出し側が続きを止められる */
  const write = useCallback(
    async (fileId: FileId, ops: JudgmentOp[]): Promise<boolean> => {
      setState((s) => ({ ...s, busy: true, error: null }));
      try {
        await appendJudgment(
          {
            // **開いている File のときだけ tap の clock を使う。**clock 空間は File
            // ごとなので、別の File の tap で発番してはならない (承認がこの場合)
            clock: fileId === activeFileId ? clock : null,
            actor,
            putJudgment,
            newBatchId,
          },
          fileId,
          ops,
          // 直前に読んだ判断ログを渡す。**渡さないとグラフ側の clock だけで発番して
          // しまい、判断ログの方が進んでいるときに衝突する**
          knownRef.current,
        );
        // **書いた直後は必ず読み直す** (進行中の読みに相乗りしない)
        await refresh(fileId, true);
        return true;
      } catch (error) {
        setState((s) => ({ ...s, busy: false, error: describe(error) }));
        return false;
      }
    },
    [actor, clock, activeFileId, newBatchId, refresh],
  );

  /**
   * ハンドル名で参加依頼する。名簿に載るのは DID なので、先に解決する。
   *
   * **複数を 1 つの batch で書く。**依頼はまとめて出すもの (仕様: `,` 区切りで並べる)
   * なので、1 人ずつ batch にすると clock が人数分進み、判断ログが依頼のたびに
   * 膨らむ。畳み込みは 1 batch の中の op を順に見るので、まとめても結果は変わらない。
   *
   * **書く前に確かめる。**見つからないハンドル、既に参加している人、別の PDS の
   * アカウントは、書いても畳み込みが捨てる。捨てられると分かっているものを書かず、
   * その場で理由を返す (仕様「その旨をダイアログで知らせる」)。
   *
   * **通る分は書く。**5 人中 1 人が見つからないときに 4 人分を捨てると、
   * 打ち直しになる。通った分を書いて、通らなかった分だけを知らせる。
   */
  const invite = useCallback(
    async (fileId: FileId, handles: readonly string[]) => {
      setState((s) => ({ ...s, busy: true, error: null }));
      const { targets, problems } = await planInvitations(
        {
          resolveHandle,
          isLocalDid: isDidOnThisPds,
          isParticipating: (did) =>
            state.rows.some((r) => r.did === did && r.status === 'accepted'),
        },
        handles,
      );

      if (targets.length > 0) {
        await write(
          fileId,
          targets.map((target) => ({
            kind: 'participation.invite' as const,
            target,
          })),
        );
      }
      // **`write` の後に置く。**`refresh` が error を消すので、先に置くと消える
      if (problems.length > 0)
        setState((s) => ({ ...s, busy: false, error: problems.join('、') }));
      else if (targets.length === 0) setState((s) => ({ ...s, busy: false }));
    },
    [state.rows, write],
  );

  /** 一覧の action を実行する。`preview` は書き込みを伴わない */
  const act = useCallback(
    async (fileId: FileId, action: RosterAction, did: Did) => {
      switch (action) {
        case 'accept': {
          // 承認は「どこを読めば招待が見つかるか」を伴う。招待者は一覧の行が持っている
          const inviter = state.rows.find((r) => r.did === did)?.inviter;
          if (!inviter) {
            setState((s) => ({ ...s, error: '招待者が分からない' }));
            return;
          }
          return write(fileId, [{ kind: 'participation.accept', inviter }]);
        }
        case 'resign':
          return write(fileId, [{ kind: 'participation.resign' }]);
        case 'revoke':
          return write(fileId, [{ kind: 'participation.revoke', target: did }]);
        case 'reinvite':
          // 離脱した人をもう一度呼ぶ。**ハンドル名を引き直さない** — 名簿が持って
          // いるのは DID で、依頼に要るのも DID である (ハンドル名は付け替えられる)
          return write(fileId, [{ kind: 'participation.invite', target: did }]);
        case 'preview':
          // まだ参加していない File の中身を見る操作。**Phase 2 で繋ぐ** —
          // 他 actor のグラフを読む経路がまだ無い
          setState((s) => ({
            ...s,
            error: '中身の表示は step2 Phase 2 で繋ぐ',
          }));
          return;
      }
    },
    [state.rows, write],
  );

  /**
   * 参加コードを検める。**まだ何も書かない。**
   *
   * **起点は自分ではなく、コードが指す依頼者である。**自分はまだ名簿に載っていないので
   * 自分の repo から辿れない (「読む資格は名簿への所属と独立」— architecture §2)。
   *
   * 書く前に依頼の実在を確かめる。承認だけ書いても、依頼が無ければ畳み込みが
   * `issuerNotInvited` で捨てる — 捨てられると分かっているものを書かない。
   *
   * あわせて**人に見せる名前を引く** — 依頼者と自分のハンドル名、File の名前。
   * 承認の前に「何に参加するのか」が分からなければ、判断のしようがない。
   */
  const previewCode = useCallback(
    async (code: string): Promise<InvitationPreview | null> => {
      const decoded = decodeParticipationCode(code);
      if (!decoded.ok) {
        setState((s) => ({ ...s, error: FAILURE_MESSAGE[decoded.reason] }));
        return null;
      }
      const { fileId, inviter, invitee } = decoded.payload;
      if (invitee !== viewer) {
        setState((s) => ({
          ...s,
          error: 'この参加コードは別のアカウント宛である',
        }));
        return null;
      }

      setState((s) => ({ ...s, busy: true, error: null }));
      try {
        // 依頼者の repo だけを読む (passes: 0)。承認は自分が書くのでまだ無い
        const seen = await loadRoster({
          fileId: fileId as FileId,
          seed: inviter,
          passes: 0,
        });
        if (seen.participation.invited.get(viewer) !== inviter) {
          setState((s) => ({
            ...s,
            busy: false,
            error: '参加依頼が見つからない。取り消された可能性がある',
          }));
          return null;
        }
        // **承認まで持ち越す。**書くときの clock の seed に要る
        knownRef.current = seen.batches;

        const ref = remoteFileRef(inviter, fileId as FileId);
        const [labelOf, nameOf] = await Promise.all([
          handleLabels.resolve([inviter, viewer]),
          fileNameLabels.resolve([ref]),
        ]);
        const preview: InvitationPreview = {
          fileId: fileId as FileId,
          inviter,
          inviterLabel: labelOf(inviter),
          inviteeLabel: labelOf(viewer),
          fileName: nameOf(ref),
        };
        setState((s) => ({ ...s, busy: false, error: null, preview }));
        return preview;
      } catch (error) {
        setState((s) => ({ ...s, busy: false, error: describe(error) }));
        return null;
      }
    },
    [viewer],
  );

  /**
   * 検めた依頼を承認する。
   *
   * **グラフの中身はここでは同期しない。**他 actor の op-log を読むのは Phase 2 である。
   */
  const acceptPreviewed = useCallback(
    async (preview: InvitationPreview): Promise<FileId | null> => {
      // **失敗したら null を返す。**以前は書けたかどうかによらず fileId を返しており、
      // 呼び出し側がダイアログを閉じて `reset()` するので、**エラーが表示される前に
      // 消えていた** — 画面にもコンソールにも何も出ないまま承認が無かったことになる
      // (2026-09-05 実機で発覚)
      const ok = await write(preview.fileId, [
        { kind: 'participation.accept', inviter: preview.inviter },
      ]);
      return ok ? preview.fileId : null;
    },
    [write],
  );

  /** コードを入れ直す段に戻る */
  const clearPreview = useCallback(
    () => setState((s) => ({ ...s, preview: null, error: null })),
    [],
  );

  /** 招待済の行に出す参加コード */
  const codeFor = useCallback(
    (fileId: FileId, did: Did): string | null => {
      const row = state.rows.find((r) => r.did === did);
      if (!row?.inviter) return null;
      return encodeParticipationCode({
        fileId,
        inviter: row.inviter,
        invitee: did,
      });
    },
    [state.rows],
  );

  const reset = useCallback(() => {
    knownRef.current = [];
    setState(EMPTY);
  }, []);

  return {
    state,
    refresh,
    invite,
    act,
    previewCode,
    acceptPreviewed,
    clearPreview,
    codeFor,
    reset,
  };
}

/** 判断を捨てた理由を、何が起きたか分かる文にする */
const REJECT_REASON_LABEL: Record<RejectReason, string> = {
  issuerNotParticipating: '発行者が参加者でない',
  issuerNotInvited: '発行者が招待されていない',
  targetNotInRoster: '対象が名簿にいない',
  targetAlreadyParticipating: '対象は既に参加者',
  targetForeignPds: '対象が別の PDS のアカウント',
  duplicateGenesis: '起点が二重',
};

/**
 * 捨てた判断の要約。1 件も無ければ `null`。
 *
 * 理由ごとにまとめる — 同じ理由で 10 件落ちたときに 10 行出しても読めない。
 */
function describeRejected(
  rejected: readonly RejectedJudgment[],
): string | null {
  if (rejected.length === 0) return null;
  const counts = new Map<RejectReason, number>();
  for (const r of rejected)
    counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
  const parts = [...counts].map(
    ([reason, n]) => `${n} 件 (${REJECT_REASON_LABEL[reason]})`,
  );
  return `名簿に反映できなかった判断がある: ${parts.join(', ')}`;
}

/** 復号の失敗理由を、ユーザにしてもらうことが分かる文にする */
const FAILURE_MESSAGE: Record<DecodeFailure, string> = {
  malformed: '参加コードとして読めない。貼り付け直してほしい',
  unsupportedVersion:
    'この参加コードは古い形式である。発行し直してもらってほしい',
  invalidFields: '参加コードの中身が揃っていない。発行し直してもらってほしい',
};

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
