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
} from '@conversensus/shared';
import { didFromActor } from '@conversensus/shared';
import { useCallback, useRef, useState } from 'react';
import { resolveHandle } from '../atproto/identity';
import { loadRoster, putJudgment } from '../atproto/judgmentStore';
import { appendJudgment } from '../sync/appendJudgment';
import type { DecodeFailure } from '../sync/participationCode';
import {
  decodeParticipationCode,
  encodeParticipationCode,
} from '../sync/participationCode';
import type { RosterAction, RosterRow } from '../sync/rosterView';
import { rosterRows } from '../sync/rosterView';
import type { TapClock } from './useEventSyncTap';

export type ParticipationState = {
  rows: RosterRow[];
  /** 読めなかった repo。名簿が欠けている可能性を画面に出すために持つ */
  unreadable: Did[];
  /** 今わかっている判断ログ。**clock の seed に使うので捨ててはならない** */
  known: JudgmentBatch[];
  busy: boolean;
  error: string | null;
};

const EMPTY: ParticipationState = {
  rows: [],
  unreadable: [],
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
        const result = await loadRoster({ fileId, seed: viewer });
        knownRef.current = result.batches;
        setState({
          rows: rosterRows(result.participation, viewer),
          unreadable: result.unreadable.map((u) => u.did),
          known: result.batches,
          busy: false,
          error: null,
        });
      } catch (error) {
        setState((s) => ({ ...s, busy: false, error: describe(error) }));
      }
    },
    [viewer],
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

  /** ハンドル名で招待する。名簿に載るのは DID なので、先に解決する */
  const invite = useCallback(
    async (fileId: FileId, handle: string) => {
      setState((s) => ({ ...s, busy: true, error: null }));
      const did = await resolveHandle(handle);
      if (!did) {
        setState((s) => ({
          ...s,
          busy: false,
          error: `ハンドル ${handle} が見つからない`,
        }));
        return;
      }
      await write(fileId, [{ kind: 'participation.invite', target: did }]);
    },
    [write],
  );

  /** 一覧の action を実行する。`preview` は書き込みを伴わない */
  const act = useCallback(
    async (fileId: FileId, action: RosterAction, did: Did) => {
      switch (action) {
        case 'accept':
          return write(fileId, [{ kind: 'participation.accept' }]);
        case 'resign':
          return write(fileId, [{ kind: 'participation.resign' }]);
        case 'revoke':
          return write(fileId, [{ kind: 'participation.revoke', target: did }]);
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
    [write],
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
        await write(fileId as FileId, [{ kind: 'participation.accept' }]);
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
