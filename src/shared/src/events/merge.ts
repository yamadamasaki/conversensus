/**
 * ログマージ (step1 Phase 2 / step2 ANA-206)
 *
 * 現行の `mergeBranchToTrunk` (レコード複製) を置換する。ブランチのマージを
 * 「ブランチの batches を trunk へ追記する」操作として表現する (O3 spike の設計)。
 *
 * D7 の解決ルール:
 *   - content  : LWW (projection の clock 順畳み込みで確定) + 並行変更を「対立」として検出
 *   - layout   : LWW のみ (対立にしない)。追記して projection に委ねる
 *   - structure: 追記して projection に委ねる (clock-LWW) + 競合を検出 (step 2)
 *
 * 解決そのものは `projectBatches` の決定論的な clock 順畳み込みに委ね、
 * この関数は「追記 + 対立の検出」に集中する。
 *
 * structure の競合が content と違うのは、**片方の操作がもう片方の前提を壊す**
 * という非対称なものを含む点である (`deepse/requirements/spec/merging.md`)。
 *
 * properties の対立は**プロパティ 1 つを単位**に判定する (ANA-208)。target 単位だと
 * 別々のプロパティを触っただけの二人が競合になる。
 */

import { type CascadeGraphView, cascadeOfRemoval, isRemoveOp } from './cascade';
import { canonicalPropertyName } from './properties';
import type { Batch, BatchId, Op, PropertyName } from './unified';
import { isContentOp } from './unified';

/** 競合の片側。ours は trunk 側、theirs は branch 側 */
type ConflictSide = { batchId: BatchId; op: Op };

type MergeConflictBase = {
  /** 競合している要素の id。削除依存では「削除された要素」を指す */
  target: string;
  /** properties の競合なら、競合しているプロパティの名前 (判定はキー単位である) */
  propertyName?: PropertyName;
  ours: ConflictSide; // trunk 側
  theirs: ConflictSide; // branch 側
};

/**
 * structure 競合の種別 (spec/merging.md の分類)
 * - `removeDependency`: 片方が削除した要素を、もう片方が前提にしている (非対称。S1/S2/S4)
 * - `parallelChange`  : 同じ対象の「一つしか持てない値」を並行に変更した (対称。S3/S5)
 */
export type StructureConflictKind = 'removeDependency' | 'parallelChange';

/** 並行変更 = 合意形成の機会。グラフ上に可視化する候補 */
export type MergeConflict =
  | (MergeConflictBase & { category: 'content' })
  | (MergeConflictBase & {
      category: 'structure';
      kind: StructureConflictKind;
    });

/**
 * **適用前に人の確認を要する競合か** (Phase 3 T1 の決着)。
 *
 * `merging.md` の 3 段のうち、content は DtR graph の強制起動、structure は通知から
 * 手動で DtR 起動 — どちらも人の判断が要る。layout は「通知のみで DtR を起動しない」と
 * 決めた種別なので確認では止めない (共同編集で二人が同じノードを動かすのは日常的で、
 * 毎回止めると確認がノイズになる)。**T3 で layout の検出が入ってもこの述語は変えない。**
 *
 * 止める理由は merge が不可逆だからである — trunk op-log への追記に revert の経路は無い。
 */
export function requiresConfirmation(conflict: MergeConflict): boolean {
  return conflict.category === 'content' || conflict.category === 'structure';
}

export type MergeResult = {
  /** trunk へ追記される、マージ後のログ (projection で解決される) */
  merged: Batch[];
  /** 検出された対立 (content / structure) */
  conflicts: MergeConflict[];
};

// op を target 持ちに絞って扱う — 対立検出は target ごとに引くので、target を
// 持たない op (sheet.reorder 等) が混ざらないことを型で示す
type OpWithTarget = Extract<Op, { target: unknown }>;
type TaggedOp = { batchId: BatchId; clock: number; op: OpWithTarget };

/**
 * **対立を数える単位**。同じ `key` に異なる `value` が並ぶことを対立と呼ぶ。
 *
 * 単位が op そのものだと粒度が粗すぎる。properties は複数のプロパティを 1 つの op に
 * 載せていたので、A が `foo` を B が `bar` を編集しただけで「同じ target への異なる値」に
 * なってしまう (`deepse/requirements/spec/merging.md`「op の粒度」)。そこで
 * properties だけはプロパティ 1 つずつに割る。
 */
type ConflictUnit = TaggedOp & {
  /** 対立の同一性。同じ target でもプロパティが違えば別の単位になる */
  key: string;
  /** 差異の判定に使う値 */
  value: unknown;
  propertyName?: PropertyName;
};

/**
 * 「一つしか持てない値」を持つ structure op。並行変更が content と同型の対立になる。
 *
 * `node.setParent` は所属グループを 1 つだけ、`edge.reconnect` は端点の組を 1 つだけ
 * しか持てないので、両側が別の値に変えたらどちらかしか残らない。
 */
const PARALLEL_STRUCTURE_KINDS = new Set<Op['kind']>([
  'node.setParent',
  'edge.reconnect',
]);

function isParallelStructureOp(op: Op): boolean {
  return PARALLEL_STRUCTURE_KINDS.has(op.kind);
}

/**
 * **この op が成立するために存在していなければならない要素**の id。
 *
 * 削除依存の検出はこれ一本で S1/S2/S4 をまとめて導く。自分が作る/消す要素は
 * 前提ではないので含めない (`node.add` の target、`*.remove` の target)。
 *
 * layout と presentation は対象外である。layout の競合は「通知のみで DtR を
 * 起動しない」と決めたので (spec/merging.md)、削除依存の判定には混ぜない。
 */
function prerequisitesOf(op: Op): string[] {
  switch (op.kind) {
    // 自分が作る/消すものは前提ではない。ただし作成時の所属先は前提になる
    case 'node.add':
      return op.parentId ? [op.parentId] : [];
    case 'node.remove':
    case 'edge.remove':
      return [];

    // 既存要素を動かす/繋ぎ替える — 対象と、新しい接続先の両方が要る
    case 'node.setParent':
      return op.parentId ? [op.target, op.parentId] : [op.target];
    case 'edge.add':
      return [op.source, op.dest];
    case 'edge.reconnect':
      return [op.target, op.source, op.dest];

    // 既存要素の中身を変える — 対象が要る
    case 'node.setContent':
    case 'node.setProperty':
    case 'node.setProperties':
    case 'edge.setLabel':
    case 'edge.setProperty':
    case 'edge.setProperties':
      return [op.target];

    default:
      return [];
  }
}

function hasTarget(op: Op): op is OpWithTarget {
  return 'target' in op;
}

function flattenOps(batches: Batch[], keep: (op: Op) => boolean): TaggedOp[] {
  const out: TaggedOp[] = [];
  for (const batch of batches) {
    for (const op of batch.ops) {
      if (keep(op) && hasTarget(op)) {
        out.push({ batchId: batch.id, clock: batch.clock, op });
      }
    }
  }
  return out;
}

/**
 * プロパティの単位キー。target だけの単位キーと衝突しない形にする。
 *
 * **名前は新名へ寄せる** (#137)。移行期には片方の端末が旧名 (`imageUrl`) を、もう片方が
 * 新名 (`app.conversensus.imageUrl`) を書き得る。寄せないと同じプロパティの並行変更が
 * 別々の単位になって競合を取り逃す。
 */
/**
 * **区切りは `\u0000` をエスケープで書く。**生のヌルバイトをソースに置くと、
 * ファイルが binary 扱いになって **`grep` / `ripgrep` がこのファイルを黙って飛ばす**
 * (2026-09-06 に実際に躓いた — 検索が 0 件を返すので、無いのか読めていないのか
 * 区別がつかない)。値は同じである。
 */
function propertyKeyOf(target: string, name: PropertyName): string {
  return `${target}\u0000${canonicalPropertyName(name)}`;
}

/**
 * op を対立の単位に割る。properties 以外は op そのものが 1 単位である。
 *
 * 旧形式の `*.setProperties` (置換) も、新形式と同じ土俵で比べられるようにプロパティ
 * ごとに割る。ただし**置換が暗に行うキーの削除は表せない** — 旧形式どうしのマージで
 * 「片方が消したキーを片方が編集した」を取り逃す。新規には旧形式を発行しないので、
 * これは移行期の既存ログの間だけの穴である。
 */
function unitsOf(t: TaggedOp): ConflictUnit[] {
  const { op } = t;
  switch (op.kind) {
    case 'node.setProperty':
    case 'edge.setProperty':
      return [
        {
          ...t,
          key: propertyKeyOf(op.target, op.name),
          value: op.value,
          propertyName: canonicalPropertyName(op.name),
        },
      ];
    case 'node.setProperties':
    case 'edge.setProperties':
      return Object.entries(op.properties).map(([name, value]) => ({
        ...t,
        key: propertyKeyOf(op.target, name),
        value,
        propertyName: canonicalPropertyName(name),
      }));
    default:
      return [{ ...t, key: op.target, value: op }];
  }
}

function flattenUnits(
  batches: Batch[],
  keep: (op: Op) => boolean,
): ConflictUnit[] {
  return flattenOps(batches, keep).flatMap(unitsOf);
}

/** 単位ごとの「最後の変更」を引く索引 (clock 最大) */
function lastByKey(units: ConflictUnit[]): Map<string, ConflictUnit> {
  const m = new Map<string, ConflictUnit>();
  for (const u of units) {
    const prev = m.get(u.key);
    if (!prev || u.clock > prev.clock) m.set(u.key, u);
  }
  return m;
}

function valueDiffers(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/**
 * 同じ target への並行変更を対立として集める。content と structure で同型なので
 * 共通化してある — 違うのは「どの op を見るか」と「結果に付ける分類」だけ。
 */
function collectParallelChanges(
  trunkAfterBase: Batch[],
  branchBatches: Batch[],
  keep: (op: Op) => boolean,
  label: (base: MergeConflictBase) => MergeConflict,
): MergeConflict[] {
  const ourLast = lastByKey(flattenUnits(trunkAfterBase, keep));
  const out: MergeConflict[] = [];
  for (const theirs of flattenUnits(branchBatches, keep)) {
    const ours = ourLast.get(theirs.key);
    if (ours && valueDiffers(ours.value, theirs.value)) {
      out.push(
        label({
          target: theirs.op.target,
          ...(theirs.propertyName !== undefined && {
            propertyName: theirs.propertyName,
          }),
          ours: { batchId: ours.batchId, op: ours.op },
          theirs: { batchId: theirs.batchId, op: theirs.op },
        }),
      );
    }
  }
  return out;
}

/**
 * 片方が削除した要素を、もう片方が前提にしている組を集める (非対称)。
 *
 * `removals` と `dependents` は trunk/branch のどちらでもよいが、結果の
 * ours/theirs は常に「ours = trunk 側、theirs = branch 側」に揃える。
 *
 * **判定は「op に書かれた id」ではなく「分岐点の状態にカスケードを当てて求めた、
 * 実際に消える要素の集合」に対して行う** (Phase 3 T1, `merging.md` の S1' / S2')。
 * グループを 1 つ消すと子孫と端点を失うエッジも消えるので、op の target だけを見ると
 * 子への依存を取り逃す。グループはまとめて消す操作なので、共同作業では直接参照より
 * 起こりやすい。
 */
function collectRemoveDependencies(
  base: CascadeGraphView,
  removals: Batch[],
  dependents: Batch[],
  removalIsOurs: boolean,
): MergeConflict[] {
  const removed = new Map<string, TaggedOp>();
  for (const t of flattenOps(removals, isRemoveOp)) {
    if (!isRemoveOp(t.op)) continue; // flattenOps の述語を型に伝える
    const cascade = cascadeOfRemoval(base, t.op);
    for (const id of [...cascade.nodes, ...cascade.edges]) {
      // その要素を**最初に**壊した削除に帰属させる。入力の並び順に依らないよう
      // clock → batchId で決める (同 clock は別 actor の並行削除でありうる)
      const prev = removed.get(id);
      if (
        !prev ||
        t.clock < prev.clock ||
        (t.clock === prev.clock && t.batchId < prev.batchId)
      ) {
        removed.set(id, t);
      }
    }
  }
  if (removed.size === 0) return [];

  const out: MergeConflict[] = [];
  for (const batch of dependents) {
    for (const op of batch.ops) {
      for (const id of prerequisitesOf(op)) {
        const removal = removed.get(id);
        if (!removal) continue;
        const removalSide = { batchId: removal.batchId, op: removal.op };
        const dependentSide = { batchId: batch.id, op };
        out.push({
          target: id, // 競合の主題は「消された要素」
          category: 'structure',
          kind: 'removeDependency',
          ours: removalIsOurs ? removalSide : dependentSide,
          theirs: removalIsOurs ? dependentSide : removalSide,
        });
      }
    }
  }
  return out;
}

/**
 * base 以降の trunk batches と branch batches をマージする。
 *
 * @param base           **分岐点のグラフ**。削除のカスケードをここに当てて「実際に
 *   消える要素」を求める (Phase 3 T1)。カスケードが絡まない検出には効かないので、
 *   状態を持たない呼び出しは空のグラフを渡してよい
 * @param trunkAfterBase 分岐点 (base) 以降に trunk 側で追記された batches
 * @param branchBatches  ブランチ側で追記された batches
 *
 * **既知の限界**: カスケードは分岐点の状態に当てる。分岐後に相手側が
 * `node.setParent` でグループに入れたノードは、分岐点では子孫でないので削除の
 * 巻き添えとして数えられない。取り逃すのは「分岐後に依存関係が生まれた」場合だけで、
 * 仕様が名指しする「グループを消すと中身も消える」(S1' / S2') は分岐点で足りる。
 */
export function mergeBranches(
  base: CascadeGraphView,
  trunkAfterBase: Batch[],
  branchBatches: Batch[],
): MergeResult {
  // 解決は projection の clock 順畳み込みに委ねるため、両者を素直に連結する
  const merged = [...trunkAfterBase, ...branchBatches];

  const conflicts: MergeConflict[] = [
    // content の並行変更
    ...collectParallelChanges(
      trunkAfterBase,
      branchBatches,
      isContentOp,
      (base) => ({ ...base, category: 'content' }),
    ),
    // structure の並行変更 (S3/S5)
    ...collectParallelChanges(
      trunkAfterBase,
      branchBatches,
      isParallelStructureOp,
      (base) => ({ ...base, category: 'structure', kind: 'parallelChange' }),
    ),
    // structure の削除依存 (S1/S2/S4)。どちらが削除した場合も拾う
    ...collectRemoveDependencies(base, trunkAfterBase, branchBatches, true),
    ...collectRemoveDependencies(base, branchBatches, trunkAfterBase, false),
  ];

  return { merged, conflicts };
}
