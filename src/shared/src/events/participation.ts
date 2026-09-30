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
import { type CausalPoint, happenedBefore } from './causality';
import type { JudgmentBatch, JudgmentOp } from './judgment';
import {
  type Actor,
  type BatchId,
  compareByClockActorId,
  didFromActor,
  type Lamport,
} from './unified';

/**
 * 参加していた期間。`to` / `closed` が無ければ現在も参加中である。
 *
 * **期間の判定は因果の点で行う** (`opened` / `closed`, step3 Phase 1 D5)。
 * 「参加していた期間の op-log だけを同期する」(step2 Phase 2) の判定は、step2 では
 * Lamport clock の区間 (`from <= clock < to`) だった。これは**別の actor の clock どうしを
 * 比べていた** — 取り消した人の clock と、取り消された人の batch の clock である
 * (step3-entry §2.1 の 4 つ目の限界)。
 *
 * `from` / `to` (clock) は期間の**鍵と表示**に残す (再参加の義務の鍵 `rejoinObligation`)。
 *
 * 期間は `history` の出来事から導く (`periodsOf`)。**書き込み先は出来事だけ**である。
 */
export type ParticipationPeriod = {
  from: Lamport;
  to?: Lamport;
  /** 期間を開いた判断 (genesis / accept / reopen) の点 */
  opened: CausalPoint;
  /** 期間を閉じた判断 (resign / revoke) の点 */
  closed?: CausalPoint;
};

/** 名簿に起きた出来事の種類。op の種類とそのまま対応する */
export type ParticipationEventKind =
  | 'genesis'
  | 'invite'
  | 'accept'
  | 'resign'
  | 'revoke'
  | 'reopen';

/**
 * 名簿に起きた 1 つの出来事。**採択された op だけが載る。**
 *
 * 参加履歴の画面は「依頼日時 / 参加日時 / 取り止め日時と, 誰がそれを行ったか」を出す
 * (`deepse/requirements/spec/participation.md` の図)。材料は batch の `timestamp` と
 * `actor` に載っているが、**生の batch から画面側で組んではならない** — pre 条件で
 * 捨てられた依頼や取り消しまで履歴に出てしまう。「採択された op だけが履歴に載る」以上、
 * これは畳み込みの仕事である。
 *
 * `rejected` が捨てた op の出所を残しているのと対になっている。
 */
export type ParticipationEvent = {
  kind: ParticipationEventKind;
  /** 順序を決めるもの。**同期のフィルタが使うのはこちら** */
  clock: Lamport;
  /**
   * 画面に出す日時。**順序付けには使わない** (端末の時計はずれる)。
   *
   * genesis は 0 に固定されている — batch がべき等であるために id も clock も
   * timestamp も fileId と actor から決まるからで、**作成者の参加日時は記録されていない**。
   * 画面はこれを日付にせず `—` と出す (`formatDay`)。
   */
  timestamp: number;
  /** これを行った人の DID。依頼と取り消しは対象と別人である */
  by: Did;
  /**
   * その判断 batch の因果の点。**参加期間の判定はこれで行う** (`wasParticipatingIn`)。
   * 判断ログはグラフの op-log と連番を共有するので (step3 Phase 1 D1)、グラフの batch と
   * 直接比べられる
   */
  point: CausalPoint;
};

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
  | 'duplicateGenesis'
  /** 引き取ろうとしたが, まだ誰かが参加している */
  | 'rosterNotEmpty'
  /** 引き取ろうとしたが, 起点がまだ見えていない (引き取る名簿が無い) */
  | 'noGenesis';

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

/**
 * 名簿から外れた理由。**取り消されたのか自分で降りたのかは、外から見て区別がつかない。**
 * 仕様の UI 一覧が `revoked` と `resigned` を別の状態として並べるので、畳み込みが
 * 覚えていなければ画面に出せない (op を後から探し直すと、pre 条件で捨てた取り消しまで
 * 拾ってしまう)。
 */
export type DepartureReason = 'revoked' | 'resigned';

export type Participation = {
  /** 現在参加している DID */
  participating: ReadonlySet<Did>;
  /** 招待済・未承認。**値は招待者の DID** — UI の一覧が「誰が招待したか」を出すため */
  invited: ReadonlyMap<Did, Did>;
  /**
   * 名簿から外れた DID と、その理由。**再参加すると消える** — 「今どういう状態か」を
   * 表すものであって、履歴ではない (履歴は `history` が持つ)。
   */
  departed: ReadonlyMap<Did, DepartureReason>;
  /**
   * DID ごとの出来事の列 (clock 昇順)。参加履歴の画面と、Phase 2 の同期フィルタが使う。
   *
   * **依頼も載る。**「依頼されたが取り消された」は参加期間にならないが、履歴には出る。
   * したがって `history.has(did)` は「一度でも参加したか」を意味しない —
   * それは `hasEverParticipated` で見る。
   */
  history: ReadonlyMap<Did, readonly ParticipationEvent[]>;
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
  const departed = new Map<Did, DepartureReason>();
  const history = new Map<Did, ParticipationEvent[]>();
  const rejected: RejectedJudgment[] = [];
  let genesisSeen = false;

  for (const batch of [...batches].sort(compareByClockActorId)) {
    // 名簿は **DID 単位**、actor は **端末単位** である。同じ人の 2 台目を
    // 別の参加者にしないため、ここで DID へ落とす
    const issuer = didFromActor(batch.actor);

    /** `subject` に起きた出来事として記録する。**採択された op だけを通す** */
    const record = (subject: Did, kind: ParticipationEventKind) => {
      const events = history.get(subject) ?? [];
      events.push({
        kind,
        clock: batch.clock,
        timestamp: batch.timestamp,
        by: issuer,
        point: { actor: batch.actor, seq: batch.seq, deps: batch.deps },
      });
      history.set(subject, events);
    };

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
          departed.delete(issuer);
          record(issuer, 'genesis');
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
          departed.delete(op.target);
          record(op.target, 'invite');
          break;

        case 'participation.accept':
          if (!invited.has(issuer)) {
            reject('issuerNotInvited');
            break;
          }
          invited.delete(issuer);
          participating.add(issuer);
          departed.delete(issuer);
          record(issuer, 'accept');
          break;

        case 'participation.resign':
          if (!participating.has(issuer)) {
            reject('issuerNotParticipating');
            break;
          }
          participating.delete(issuer);
          departed.set(issuer, 'resigned');
          record(issuer, 'resign');
          break;

        case 'participation.reopen':
          // **誰もいなくなった File を引き取る。**起点を要求するのは、起点が無い
          // File には「引き取る名簿」がそもそも無いからである (それは
          // `ensureOwnGenesis` が直す別の状態で、混ぜると起点の修復が 2 通りになる)
          if (!genesisSeen) {
            reject('noGenesis');
            break;
          }
          if (participating.size > 0) {
            reject('rosterNotEmpty');
            break;
          }
          participating.add(issuer);
          departed.delete(issuer);
          invited.delete(issuer);
          record(issuer, 'reopen');
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
          departed.set(op.target, 'revoked');
          participating.delete(op.target);
          // **依頼のまま取り消された場合も記録する。**参加期間にはならないが、
          // 参加履歴の「依頼取り止め」列はこれを出す
          record(op.target, 'revoke');
          break;
      }
    }
  }

  return { participating, invited, departed, history, rejected };
}

/**
 * その点 (グラフの batch) が、DID の参加期間の中で書かれたか。同期のフィルタが使う
 * (step3 Phase 1 D5)。
 *
 * ある期間について、次の 2 つを満たせば中である:
 *
 * 1. **期間を開いた判断が、その点の因果の過去にある** — 参加してから書いた。同じ人の別端末で
 *    承認した場合も、承認を受け取ってから書いたものだけが入る
 * 2. 期間が閉じているなら、**その点が、閉じた判断の因果の過去にある** — 取り消した人
 *    (自分で辞めたなら自分) が**見ていた**操作だけが有効である
 *
 * 2 が要点である。取り消された人が取り消しを知らずに続けた編集は、clock がいくつであっても
 * 誰の手元でも落ちる。逆に取り消した人が見ていた編集は、clock が取り消しより大きくても入る。
 * step2 の clock の区間はこの両方で逆の答えを出しえた。
 *
 * genesis の判断は seq 0 なので (`JUDGMENT_GENESIS_SEQ`)、あらゆる点の因果の過去にある —
 * 作成者の期間は File の始まりから開いている。
 */
export function wasParticipatingIn(
  participation: Participation,
  did: Did,
  point: CausalPoint,
): boolean {
  return periodsOf(participation, did).some(
    (p) =>
      happenedBefore(p.opened, point) &&
      (p.closed === undefined || happenedBefore(point, p.closed)),
  );
}

/**
 * 出来事の列から参加期間を導く。
 *
 * **期間を別に持たない。**持つと書き込み先が 2 つになり、片方だけ更新する事故が起きる。
 * 1 DID あたりの出来事は参加ラウンドの数しかない (数件) ので、都度導いて足りる。
 */
export function periodsOf(
  participation: Participation,
  did: Did,
): ParticipationPeriod[] {
  const periods: ParticipationPeriod[] = [];
  for (const event of participation.history.get(did) ?? []) {
    switch (event.kind) {
      case 'genesis':
      case 'accept':
      case 'reopen':
        // **引き取りは新しい期間を開くだけ** — 誰もいなかった間の op は届かない
        // (仕様の決定, 2026-09-05)。遡って開くと「取り消した後の操作は反映されない」を
        // 名簿が空になる経路で迂回できてしまう
        periods.push({ from: event.clock, opened: event.point });
        break;
      case 'resign':
      case 'revoke': {
        // 開いている期間だけを閉じる。依頼のまま取り消された場合は開いていない
        const last = periods.at(-1);
        if (last && last.to === undefined) {
          last.to = event.clock;
          last.closed = event.point;
        }
        break;
      }
      case 'invite':
        break;
    }
  }
  return periods;
}

/**
 * 一度でも参加したか。**依頼されただけの人は含まない。**
 *
 * 仕様の「依頼中に依頼が取り止められた場合, 今までに参加したことがなければ
 * 一覧に表示されない」がこれを要る。
 */
export function hasEverParticipated(
  participation: Participation,
  did: Did,
): boolean {
  return (participation.history.get(did) ?? []).some(
    (e) => e.kind === 'genesis' || e.kind === 'accept' || e.kind === 'reopen',
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
