/**
 * fork — implicit merge が競合を保留した記録 (step2 Phase 3 T6)
 *
 * ## なぜ書くのか
 *
 * implicit merge そのものは op-log に書かない (冪等な導出なので記録すべきものが無い)。
 * しかし**その副産物である fork は書く** — fork は「この競合を保留した」という判断の
 * 記録であって導出結果ではないからである。書かないと、同期のたびに再計算されて
 * **ユーザが解決したはずの fork が毎回復活する** (`spec/merging.md`)。
 *
 * ## なぜ理由を凍結するのか
 *
 * 「implicit merge は冪等な導出なのだから、競合も畳み直せば再現できる」は成り立たない。
 *
 * - 畳み直して得られるのは **今**の競合であって、fork を作った時点の競合ではない
 * - そもそも**競合が消えていることがある**。負けた側の要素がその後に削除されたり、
 *   値が上書きされたりすれば、畳み直しても競合は出てこない。その時 fork は
 *   **理由のない fork** になる
 *
 * fork を書くと決めた理由の裏返しである — 再計算に委ねると、今度は**説明の方が消える**。
 * したがって記述は**検出した時点の内容を凍結して**、fork とともに書く。
 *
 * ## これは記述であって畳み込みの入力ではない
 *
 * 畳み込みはこの記述を読まないし、何の分岐条件にもならない。人間が「何でこれが
 * 生じたんだ?」に**生きた問い合わせなしで**答えられるためだけのものなので、
 * 他の actor が書いた記述と一致している必要も無い。だからこそ安く済む。
 *
 * 唯一の用途は、**この fork から DtR graph を起動するときの呼び出し対象の既定値を
 * 供給する**ことである (起動そのものは Phase 6)。
 */

import type { BranchId, CommitId, FileId, SheetId } from '../schemas';
import { type BranchMeta, makeBaseCommit } from './branchLog';
import type { LayoutAspect, MergeConflict } from './merge';
import {
  type Batch,
  BRANCH_STATUS,
  type Lamport,
  type Op,
  type PropertyName,
} from './unified';

/**
 * 競合の片側の凍結された記述。
 *
 * **`actor` と `clock` は batch から導いて焼き込む** — `MergeConflict` は `batchId` しか
 * 持たないが、後から batch を引ける保証が無い (相手の repo は参加期間の外に出ることも、
 * 読めなくなることもある)。「誰と誰が、いつ」が分からなければ相談する相手も選べない。
 */
export type ForkSide = {
  batchId: Batch['id'];
  actor: string;
  clock: Lamport;
  op: Op;
};

/** fork を生んだ競合の記述。**検出時点で凍結する** */
export type ForkOrigin = {
  /** 3 段のどれとして扱われたか */
  category: MergeConflict['category'];
  /** structure のとき、削除依存か並行変更か */
  kind?: 'removeDependency' | 'parallelChange';
  /** layout のとき、どの観点で揉めたか */
  aspect?: LayoutAspect;
  /** 揉めた要素の id */
  target: string;
  /**
   * **その時点で人間に見える形** (node の内容の冒頭など)。
   * id だけでは、後でその要素が消えていると何も分からない。
   * 名前が無い要素もあるので空文字を許す (言い換えは見せる側の判断)
   */
  targetLabel: string;
  /** content のとき、どのプロパティで揉めたか */
  propertyName?: PropertyName;
  ours: ForkSide;
  theirs: ForkSide;
  /**
   * **どこまで畳んだ状態で検出したか。**「その時点では何が見えていたか」を再現するため。
   * implicit merge の分岐点は受信前の手元の状態なので、その先端 clock がそれを表す
   */
  baseAt: Lamport;
};

/** fork は branch の一種である。器は branch と同じで、記述だけが増える */
export type ForkMeta = BranchMeta & {
  /**
   * fork の同一性。**競合そのものから導く** (`spec/merging.md` の S4 推奨)。
   *
   * implicit merge は全参加者がそれぞれの手元で行う導出なので、**同じ競合を全員が
   * 独立に検出する**。素直に作ると一つの競合に参加者の数だけ fork ができ、人間からは
   * 同じ理由の fork が並んで見える。競合そのものから導いた鍵なら誰の手元でも同じ値に
   * なるので、独立に書かれた fork は畳み込みの段階で一つにまとまる。
   *
   * **凍結した記述が食い違っていても同一性は変わらない** — 名簿の食い違いで見えている
   * 範囲が違えば記述は違いうるが、それは同一性の条件ではない。
   */
  conflictKey: string;
  /** なぜこの fork があるのか。検出時点で凍結した記述 */
  origin: ForkOrigin;
};

/** branch が fork か (記述を持つかで判る) */
export function isFork(meta: BranchMeta): meta is ForkMeta {
  return 'origin' in meta;
}

/**
 * 競合の同一性の鍵。**誰の手元でも同じ値になる**ものだけから作る。
 *
 * 対象・揉めた単位 (プロパティ名 / layout の観点)・対立した二つの batchId。
 * batchId を**整列してから**繋ぐのは、ours / theirs の割り当てが手元によって
 * 入れ替わるからである — 私から見て「新着」の op は、相手から見れば「手元」である。
 */
export function conflictKeyOf(conflict: MergeConflict): string {
  const about =
    conflict.category === 'layout'
      ? conflict.aspect
      : (conflict.propertyName ?? '');
  const sides = [conflict.ours.batchId, conflict.theirs.batchId]
    .map((id) => id as string)
    .sort();
  return [conflict.category, conflict.target, about, ...sides].join('\u0000');
}

/** fork を作るのに要る、競合の外側の事情 */
export type MakeForkParams = {
  conflict: MergeConflict;
  /** 対象の**分岐点での**見え方。空文字は「名前が無い」であって「引けなかった」ではない */
  targetLabel: string;
  /** 対立した op を含む batch を引く。actor と clock を焼き込むのに要る */
  batchOf: (batchId: Batch['id']) => Batch | undefined;
  /** 検出時点の手元のログ。分岐点 (`baseAt`) と base コミットの位置を決める */
  localBatches: Batch[];
  sheetId: SheetId;
  trunkFileId: FileId;
  authorActor: string;
  /** id の採番 (branchId / branchFileId / base commitId) */
  newId: () => string;
};

function sideOf(
  side: MergeConflict['ours'],
  batchOf: (batchId: Batch['id']) => Batch | undefined,
): ForkSide {
  const batch = batchOf(side.batchId);
  return {
    batchId: side.batchId,
    // batch が引けないことは異常ではない (相手の分は手元に無いこともある)。
    // **空で書く方が、書かないより良い** — 後から何も分からなくなるのを避ける
    actor: batch?.actor ?? '',
    clock: batch?.clock ?? 0,
    op: side.op,
  };
}

/** 競合を人が読める一行にする。fork の名前になる */
function forkNameOf(conflict: MergeConflict, targetLabel: string): string {
  const what = targetLabel === '' ? '名前のない要素' : targetLabel;
  switch (conflict.category) {
    case 'content':
      return conflict.propertyName
        ? `競合: ${what} のプロパティ「${conflict.propertyName}」`
        : `競合: ${what} の内容`;
    case 'structure':
      return conflict.kind === 'removeDependency'
        ? `競合: ${what} が消えている`
        : `競合: ${what} のつなぎ方`;
    case 'layout':
      return `競合: ${what} の位置`;
  }
}

/**
 * 競合から fork を作る。**保存はしない** — 呼び出し側が書く。
 *
 * 器は branch と同じである (`spec` の「ユーザから特殊な branch として見える」)。
 * 中身は空で、分岐点は検出時点のログ先端になる — fork は「ここで保留した」という
 * 印であって、編集を溜める場所として始まるわけではない。
 */
export function makeFork(params: MakeForkParams): ForkMeta {
  const { conflict, targetLabel, batchOf, localBatches, newId } = params;
  const base = makeBaseCommit(
    newId() as CommitId,
    forkNameOf(conflict, targetLabel),
    params.authorActor,
    localBatches,
  );
  return {
    id: newId() as BranchId,
    name: forkNameOf(conflict, targetLabel),
    base,
    status: BRANCH_STATUS.OPEN,
    sheetId: params.sheetId,
    trunkFileId: params.trunkFileId,
    branchFileId: newId() as FileId,
    conflictKey: conflictKeyOf(conflict),
    origin: {
      category: conflict.category,
      ...(conflict.category === 'structure' && { kind: conflict.kind }),
      ...(conflict.category === 'layout' && { aspect: conflict.aspect }),
      target: conflict.target,
      targetLabel,
      ...(conflict.propertyName !== undefined && {
        propertyName: conflict.propertyName,
      }),
      ours: sideOf(conflict.ours, batchOf),
      theirs: sideOf(conflict.theirs, batchOf),
      baseAt: base.at,
    },
  };
}
