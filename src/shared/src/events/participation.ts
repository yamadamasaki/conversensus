/**
 * 名簿の畳み込み (step2 Phase 1)
 *
 * 設計: `deepse/plans/step2-phase1-participation.md`
 * 仕様: `deepse/requirements/spec/participation.md`
 *
 * **op を clock 順に畳みながら pre 条件を検証し、満たさないものを捨てる**のが中核である。
 * これによって 2 つが同時に決まる。
 *
 *   - **招待されていない actor の承認は無効**になる。参加コードは秘密ではない
 *     (被招待者の DID を含むだけ) が、本人以外の承認はここで落ちる
 *   - **取り消し合いが起きても、誰の手元でも同じ結論**になる。a が a' を取り消した後、
 *     それを知らない a' が「a の取り消し」を出しても、clock 順では a' は既に名簿に
 *     いないので pre 条件を満たさず捨てられる
 *
 * 検証しないと、取り消された側が取り消し返せてしまい、手元によって結論が変わる。
 *
 * **捨てた op も返す。** UI の一覧に `invalid` を出すと決めた以上、捨てて終わりにすると
 * 画面に出せない。これは**グラフ側の projection には存在しない出力**で、名簿側の
 * 意味論がそのまま型に現れる箇所である (`deepse/architecture/step2.md` §3)。
 */

import type { Did } from '../schemas';
import type { JudgmentBatch, JudgmentOp } from './judgment';
import {
  type Actor,
  type BatchId,
  compareByClockActorId,
  didFromActor,
  type Lamport,
} from './unified';

/**
 * 参加していた期間。`to` が無ければ現在も参加中である。
 *
 * **wall clock ではなく Lamport clock で持つ。**「参加していた期間の op-log だけを
 * 同期する」(Phase 2) の判定に使うので、op-log の位置と同じ物差しでなければならない。
 */
export type ParticipationPeriod = { from: Lamport; to?: Lamport };

/** op を捨てた理由。UI の状態表示 (`invalid`) の材料になる */
export type RejectReason =
  /** 発行者が参加者でない (招待・取り消し・参加取りやめ) */
  | 'issuerNotParticipating'
  /** 発行者が招待されていないのに承認した */
  | 'issuerNotInvited'
  /** 取り消しの対象が名簿にいない */
  | 'targetNotInRoster'
  /** 招待の対象が既に参加者である */
  | 'targetAlreadyParticipating'
  /** 被招待者の DID がこの PDS に属さない (仕様は「無効とする」と定める) */
  | 'targetForeignPds'
  /** この File の genesis は既に出ている */
  | 'duplicateGenesis';

export type RejectedJudgment = {
  batchId: BatchId;
  /**
   * batch 内での op の位置。
   *
   * **batchId だけでは op を一意に指せない** — 同じ内容の op が 1 つの batch に
   * 2 つ並ぶことがあり、その一方だけが捨てられる場合がある (性質検証で見つけた:
   * `[resign, resign]` は 1 つ目が通って 2 つ目が落ちる)。UI が「この op が invalid」と
   * 示すには位置が要る。
   */
  opIndex: number;
  actor: Actor;
  clock: Lamport;
  op: JudgmentOp;
  reason: RejectReason;
};

export type Participation = {
  /** 現在参加している DID */
  participating: ReadonlySet<Did>;
  /** 招待済・未承認。**値は招待者の DID** — UI の一覧が「誰が招待したか」を出すため */
  invited: ReadonlyMap<Did, Did>;
  /** DID ごとの参加期間。Phase 2 の同期フィルタが使う */
  history: ReadonlyMap<Did, readonly ParticipationPeriod[]>;
  /** 捨てた op と理由。**`invalid` の表示元** */
  rejected: readonly RejectedJudgment[];
};

export type FoldParticipationDeps = {
  /**
   * その DID がこの PDS に属するか。
   *
   * **省略可能にしていない。**仕様は他 PDS のアカウントの招待を「やらない」ではなく
   * **「無効とする」**と定めている (`spec-step2.md`) ので、これは UI の入力チェックでは
   * なく pre 条件の一部である。既定値を持たせると、配線を忘れた瞬間に検証が消える。
   */
  isLocalDid: (did: Did) => boolean;
};

/**
 * 判断 batch 列から名簿を導く。
 *
 * 入力は **1 つの File 分**である (fileId は rkey が運ぶので batch には載っていない)。
 */
export function foldParticipation(
  batches: readonly JudgmentBatch[],
  { isLocalDid }: FoldParticipationDeps,
): Participation {
  const participating = new Set<Did>();
  const invited = new Map<Did, Did>();
  const history = new Map<Did, ParticipationPeriod[]>();
  const rejected: RejectedJudgment[] = [];
  let genesisSeen = false;

  const openPeriod = (did: Did, clock: Lamport) => {
    const periods = history.get(did) ?? [];
    periods.push({ from: clock });
    history.set(did, periods);
  };
  const closePeriod = (did: Did, clock: Lamport) => {
    const last = history.get(did)?.at(-1);
    // 開いている期間だけを閉じる。二重の close は履歴を壊すので無視する
    if (last && last.to === undefined) last.to = clock;
  };

  for (const batch of [...batches].sort(compareByClockActorId)) {
    // 名簿は **DID 単位**、actor は **端末単位** である。同じ人の 2 台目を
    // 別の参加者にしないため、ここで DID へ落とす
    const issuer = didFromActor(batch.actor);

    for (const [opIndex, op] of batch.ops.entries()) {
      const reject = (reason: RejectReason) =>
        rejected.push({
          batchId: batch.id,
          opIndex,
          actor: batch.actor,
          clock: batch.clock,
          op,
          reason,
        });

      switch (op.kind) {
        case 'participation.genesis':
          // genesis より前は名簿が空なので、他のあらゆる op が pre 条件で落ちる。
          // これが「最初の 1 人」が genesis でしか決まらないことの担保である
          if (genesisSeen) {
            reject('duplicateGenesis');
            break;
          }
          genesisSeen = true;
          participating.add(issuer);
          openPeriod(issuer, batch.clock);
          break;

        case 'participation.invite':
          if (!participating.has(issuer)) {
            reject('issuerNotParticipating');
            break;
          }
          if (!isLocalDid(op.target)) {
            reject('targetForeignPds');
            break;
          }
          if (participating.has(op.target)) {
            reject('targetAlreadyParticipating');
            break;
          }
          // 既に招待済でも捨てない。**招待者を上書きする** — 参加コードの再発行は
          // 正当な操作で、名簿の結果も変わらないためである
          invited.set(op.target, issuer);
          break;

        case 'participation.accept':
          if (!invited.has(issuer)) {
            reject('issuerNotInvited');
            break;
          }
          invited.delete(issuer);
          participating.add(issuer);
          openPeriod(issuer, batch.clock);
          break;

        case 'participation.resign':
          if (!participating.has(issuer)) {
            reject('issuerNotParticipating');
            break;
          }
          participating.delete(issuer);
          closePeriod(issuer, batch.clock);
          break;

        case 'participation.revoke':
          if (!participating.has(issuer)) {
            reject('issuerNotParticipating');
            break;
          }
          if (!invited.has(op.target) && !participating.has(op.target)) {
            reject('targetNotInRoster');
            break;
          }
          invited.delete(op.target);
          // 招待済のまま取り消された場合は期間が開いていないので閉じない
          if (participating.delete(op.target))
            closePeriod(op.target, batch.clock);
          break;
      }
    }
  }

  return { participating, invited, history, rejected };
}

/**
 * ある時点で参加していたか。Phase 2 の同期フィルタが使う。
 *
 * 期間は**閉じた始点・開いた終点** (`from <= clock < to`) とする。取りやめた瞬間の
 * clock を持つ op は、既に参加者でないものとして扱う — `resign` 自身は判断ログの op
 * なので、グラフ側の op がその clock を共有することは無い。
 */
export function wasParticipatingAt(
  participation: Participation,
  did: Did,
  clock: Lamport,
): boolean {
  const periods = participation.history.get(did);
  if (!periods) return false;
  return periods.some(
    (p) => p.from <= clock && (p.to === undefined || clock < p.to),
  );
}

/**
 * 判断 batch 列に現れる**招待先の DID** を集める。
 *
 * `foldParticipation` の `isLocalDid` は**同期**の述語である。「その DID がこの PDS に
 * 属するか」の判定はネットワークを伴うので、畳み込みの中では待てない。そこで
 * **畳む前にまとめて解決しておく**ための材料をここで取り出す。
 *
 * 畳み込みを同期に保つのは、それが決定論の土台だからである — 非同期にすると、
 * 「あらゆる配送順で同じ名簿になる」の検証に解決の順序まで入り込む。
 */
export function collectInviteTargets(
  batches: readonly JudgmentBatch[],
): Set<Did> {
  const targets = new Set<Did>();
  for (const batch of batches)
    for (const op of batch.ops)
      if (op.kind === 'participation.invite') targets.add(op.target);
  return targets;
}
