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
import { fetchBatches } from '../api';
import {
  handleLabels,
  isDidOnThisPds,
  resolveHandle,
} from '../atproto/identity';
import { loadRoster, putJudgment } from '../atproto/judgmentStore';
import type { LabelResolver } from '../display/labelCache';
import { appendJudgment } from '../sync/appendJudgment';
import { ensureOwnGenesis } from '../sync/ensureOwnGenesis';
import type { DecodeFailure } from '../sync/participationCode';
import {
  decodeParticipationCode,
  encodeParticipationCode,
} from '../sync/participationCode';
import { planInvitations } from '../sync/planInvitations';
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
  known: [],
  busy: false,
  error: null,
};

export type UseParticipationDeps = {
  actor: Actor;
  /** **グラフと同じ clock。**独立した採番器を渡してはならない */
  clock: TapClock;
  newBatchId?: () => BatchId;
};

export function useParticipation({
  actor,
  clock,
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

  /** 名簿を読み直して整形する。**起点は自分自身** (既に参加している File を見るため) */
  const refresh = useCallback(
    async (fileId: FileId) => {
      setState((s) => ({ ...s, busy: true, error: null }));
      try {
        let result = await loadRoster({ fileId, seed: viewer });
        // **起点が無ければ置いてから畳む。**起点の無い File では招待が 1 件残らず
        // `issuerNotParticipating` で捨てられ、名簿が永久に空になる。自分だけで
        // 書かれた File なら起点は自分にあるので、その場で置いて読み直す
        if (
          await ensureOwnGenesis(
            { fetchBatches, putJudgment, actor },
            fileId,
            result.batches,
          )
        ) {
          result = await loadRoster({ fileId, seed: viewer });
        }
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
          known: result.batches,
          busy: false,
          error: null,
        });
      } catch (error) {
        setState((s) => ({ ...s, busy: false, error: describe(error) }));
      }
    },
    [viewer, actor],
  );

  const write = useCallback(
    async (fileId: FileId, ops: JudgmentOp[]) => {
      setState((s) => ({ ...s, busy: true, error: null }));
      try {
        await appendJudgment(
          { clock, actor, putJudgment, newBatchId },
          fileId,
          ops,
          // 直前に読んだ判断ログを渡す。**渡さないとグラフ側の clock だけで発番して
          // しまい、判断ログの方が進んでいるときに衝突する**
          knownRef.current,
        );
        await refresh(fileId);
      } catch (error) {
        setState((s) => ({ ...s, busy: false, error: describe(error) }));
      }
    },
    [actor, clock, newBatchId, refresh],
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
   * 参加コードを使って承認する。
   *
   * **起点は自分ではなく、コードが指す招待者である。**自分はまだ名簿に載っていないので
   * 自分の repo から辿れない (「読む資格は名簿への所属と独立」— architecture §2)。
   *
   * 書く前に招待の実在を確かめる。承認だけ書いても、招待が無ければ畳み込みが
   * `issuerNotInvited` で捨てる — 捨てられると分かっているものを書かない。
   *
   * **グラフの中身はここでは同期しない。**他 actor の op-log を読むのは Phase 2 である。
   */
  const participate = useCallback(
    async (code: string): Promise<FileId | null> => {
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
        // 招待者の repo だけを読む (passes: 0)。承認は自分が書くのでまだ無い
        const seen = await loadRoster({
          fileId: fileId as FileId,
          seed: inviter,
          passes: 0,
        });
        if (seen.participation.invited.get(viewer) !== inviter) {
          setState((s) => ({
            ...s,
            busy: false,
            error: '招待が見つからない。取り消された可能性がある',
          }));
          return null;
        }
        knownRef.current = seen.batches;
        await write(fileId as FileId, [
          { kind: 'participation.accept', inviter },
        ]);
        return fileId as FileId;
      } catch (error) {
        setState((s) => ({ ...s, busy: false, error: describe(error) }));
        return null;
      }
    },
    [viewer, write],
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

  return { state, refresh, invite, act, participate, codeFor, reset };
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
