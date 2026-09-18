/**
 * DtR の畳み込み (step2 Phase 6)
 *
 * 設計: `deepse/plans/step2-phase6-dtr.md`
 * 仕様: `deepse/requirements/spec/dialogueToResolveGraph.md`
 *
 * **名簿と同じ collection を、別に畳む。**判断ログは「名簿」ではなく「判断」として広く
 * 切ってあり (`judgment.ts` 冒頭)、DtR の承認も名簿と同じ **pre 条件を検証して捨てる**
 * 畳み込みだからである。互いの `kind` は素通りさせる — `foldParticipation` の `switch` に
 * `default` が無いので DtR の op は名簿の「捨てた op」に入らず、ここの `switch` は
 * 名簿の op を `default` で読み飛ばす。
 *
 * **中核は「全員」を可変な問い合わせにしないこと**である (仕様「承認の判定」)。名簿は
 * 共同作業者の間で食い違ってよいと決めたので、「全員が承認したか」を名簿への生きた
 * 問い合わせとして書くと、a の手元では「全員承認済 → 再 merge 可能」、b の手元では
 * 「1 人足りない → 保留」が**同時に、どちらも正常な状態として成立してしまう**。
 * 再 merge は trunk を書き換えるので、これは表示の食い違いでは済まない。
 *
 * **再 merge の可否はここでは決めない。**再 merge は trunk を書き換える以上グラフの batch
 * であり、pre 条件は畳み込みの**手前で落とす** (`spikes/u6/judgmentFold.ts` の `admissible`)。
 * ここが出すのは判定の材料 (記録された呼び出し対象と、積み上がった承認) までである。
 */

import type { Did, DtrId, SheetId } from '../schemas';
import type { JudgmentBatch, JudgmentOp } from './judgment';
import {
  type Actor,
  type BatchId,
  compareByClockActorId,
  didFromActor,
  type Lamport,
} from './unified';

/** DtR の op を捨てた理由。名簿の `RejectReason` と同じく UI の材料になる */
export type DtrRejectReason =
  /** 既に起動されている DtR をもう一度起動した */
  | 'duplicateOpen'
  /** 起動されていない DtR への承認・呼び出し対象の変更 */
  | 'dtrNotOpen'
  /** 呼び出されていない actor による承認・呼び出し対象の変更 */
  | 'issuerNotCallee';

/**
 * 捨てた DtR の op と、その出所。
 *
 * 名簿の `RejectedJudgment` と**同じ形にしてある**が、別の型にしてある。理由の集合が
 * 交わらないので、1 つの型にすると「この reason はどちらの畳み込みのものか」が型から
 * 消えるためである。
 */
export type RejectedDtrJudgment = {
  batchId: BatchId;
  /** batch 内での op の位置。batchId だけでは op を一意に指せない (名簿と同じ理由) */
  opIndex: number;
  actor: Actor;
  clock: Lamport;
  op: JudgmentOp;
  reason: DtrRejectReason;
};

/** 1 つの DtR の状態 */
export type Dtr = {
  id: DtrId;
  /** dialogue graph の器 (trunk の fileId の中の sheet) */
  sheetId: SheetId;
  /**
   * **記録された**呼び出し対象。名簿への問い合わせではない。
   * `dtr.setCallees` で置き換わる (仕様「対象を追加/削除できる」)。
   */
  callees: ReadonlySet<Did>;
  /**
   * 承認した DID。**積み上がる一方**である — 呼び出し対象から外れても承認は消さない。
   * 「承認は積み上がる一方なので、集合を固定すれば判定は単調になる」(仕様) を、
   * 呼び出し対象が変わる場合にも保つための選択である。
   */
  approvals: ReadonlySet<Did>;
  /** 起動された位置。DtR の一覧を安定に並べるために持つ */
  openedAt: Lamport;
};

export type DtrJudgments = {
  dtrs: ReadonlyMap<DtrId, Dtr>;
  /** 捨てた op と理由 */
  rejected: readonly RejectedDtrJudgment[];
};

/** 畳み込みの途中だけ可変にする。外へ出すのは読み取り専用の `Dtr` である */
type MutableDtr = {
  id: DtrId;
  sheetId: SheetId;
  callees: Set<Did>;
  approvals: Set<Did>;
  openedAt: Lamport;
};

/**
 * 判断 batch 列から DtR の状態を導く。
 *
 * 入力は **1 つの File 分**である (fileId は rkey が運ぶので batch には載っていない)。
 * 名簿の op は読み飛ばすので、`foldParticipation` と同じ配列をそのまま渡してよい。
 */
export function foldDtr(batches: readonly JudgmentBatch[]): DtrJudgments {
  const dtrs = new Map<DtrId, MutableDtr>();
  const rejected: RejectedDtrJudgment[] = [];

  for (const batch of [...batches].sort(compareByClockActorId)) {
    // 承認は **DID 単位**、actor は **端末単位**である。同じ人の 2 台目を別人に
    // しないため、ここで DID へ落とす (名簿と同じ)
    const issuer = didFromActor(batch.actor);

    for (const [opIndex, op] of batch.ops.entries()) {
      const reject = (reason: DtrRejectReason) =>
        rejected.push({
          batchId: batch.id,
          opIndex,
          actor: batch.actor,
          clock: batch.clock,
          op,
          reason,
        });

      switch (op.kind) {
        case 'dtr.open':
          // 起動は 1 度だけ。2 度目を通すと、後から来た起動が呼び出し対象を
          // 書き換えられることになり、「起動時に確定する」が崩れる
          if (dtrs.has(op.target)) {
            reject('duplicateOpen');
            break;
          }
          dtrs.set(op.target, {
            id: op.target,
            sheetId: op.sheetId,
            callees: new Set(op.callees),
            approvals: new Set(),
            openedAt: batch.clock,
          });
          break;

        case 'dtr.setCallees': {
          const dtr = dtrs.get(op.target);
          if (!dtr) {
            reject('dtrNotOpen');
            break;
          }
          // 呼び出された当人たちだけが対象を変えられる。外部から変えられると、
          // 「外して先に進む」が当事者以外の判断になってしまう
          if (!dtr.callees.has(issuer)) {
            reject('issuerNotCallee');
            break;
          }
          dtr.callees = new Set(op.callees);
          break;
        }

        case 'dtr.approve': {
          const dtr = dtrs.get(op.target);
          if (!dtr) {
            reject('dtrNotOpen');
            break;
          }
          if (!dtr.callees.has(issuer)) {
            reject('issuerNotCallee');
            break;
          }
          dtr.approvals.add(issuer);
          break;
        }

        // 名簿の op は素通りさせる (同じ collection を別々に畳むため)
        default:
          break;
      }
    }
  }

  return { dtrs, rejected };
}

/**
 * 呼び出し対象の全員が承認したか。再 merge が可能になる条件の**中身**である。
 *
 * これは「揃ったか」だけを言う。再 merge の pre 条件は「揃ったのが**その操作より前**で
 * あること」なので clock の比較が要る (仕様) — それは再 merge を扱う段の仕事である。
 */
export function allApproved(dtr: Dtr): boolean {
  for (const callee of dtr.callees)
    if (!dtr.approvals.has(callee)) return false;
  return true;
}
