/**
 * branch / commit / fork のメタを trunk の op-log から畳み込む (step2 Phase 3 T7-0)
 *
 * 設計: `deepse/plans/step2-phase3-t7-branch-sync.md` §4
 *
 * これまで branch のメタは daemon の SQLite の行で、**相手に届かなかった**。T7 で
 * `branch.create` / `branch.setStatus` / `commit.add` を trunk の op-log に書くので、
 * **trunk を畳めば誰の手元でも同じ branch の一覧が出る**。この関数がその畳み込みである。
 *
 * ## 規則
 *
 * - **順序は `orderBatches` (clock → actor → id) だけで決める。**入力の並びには依存しない
 * - **`branch.create` は最初の 1 回だけが効く。**branch の実体 (名前・分岐点・専用 file_id) は
 *   作った時点で決まり、後から変える op は無い
 * - **fork は `conflictKey` で 1 つに畳む。**同じ競合を参加者が独立に検出して、それぞれ別の
 *   `BranchId` で `branch.create` を書く (`spec/merging.md` の S4)。順序で最初のものを正とし、
 *   後から来た id は**別名**として覚える — 別名に対する `branch.setStatus` も正の fork に効く
 * - **status は LWW。**`branch.setStatus` の最後のものが効く。作成直後は `open`
 * - **commit は id で重複を除く。**同じ commit が複数の経路から届いても 1 回に数える
 * - **batch も id で重複を除く。**畳み込みは batch の並びではなく集合の関数である
 * - **削除は最後にまとめて当てる (remove-wins)。**`branch.remove` を見つけた時点で当てると、
 *   それが `branch.create` より前に並ぶ log (因果に反するが、参加期間のフィルタなどで起こりうる)
 *   で、同じ競合の fork が別の id で復活する余地が残り、並びで結果が変わる。**別名を最後に
 *   解決してから**消すので、fork の別名を消しても正の fork ごと消える
 *
 * ## fork の記述は信用しない
 *
 * `origin` の中の op は op-log の段では検証していない (`ForkSideSchema` の注)。ここで
 * `OpSchema` にかけ、**合わなければ記述だけを落とす** — 同一性 (`conflictKey`) は残るので
 * 重複は防げるが、`isFork` は偽になる (理由の無い fork を理由付きのように見せない)。
 */

import type { BranchId, FileId } from '../schemas';
import type { BranchMeta, Commit } from './branchLog';
import type { ForkMeta, ForkOrigin, ForkSide } from './fork';
import { orderBatches } from './project';
import {
  type Batch,
  BRANCH_STATUS,
  ForkOriginSchema,
  type Op,
  OpSchema,
} from './unified';

export type BranchFold = {
  /** 作られた branch (fork を含む)。**畳み込みの順** (= 作成順) に並ぶ */
  branches: Map<BranchId, BranchMeta | ForkMeta>;
  /** trunk のコミット (merge を含む)。畳み込みの順 */
  trunkCommits: Commit[];
  /** branch ごとのコミット。畳み込みの順 */
  branchCommits: Map<BranchId, Commit[]>;
};

type BranchCreateOp = Extract<Op, { kind: 'branch.create' }>;

/**
 * op-log 上の fork の記述を、ドメインの `ForkOrigin` に戻す。**中の op が `OpSchema` に
 * 合わなければ `undefined`** — 記述だけを落とす。
 */
function originOf(raw: BranchCreateOp['origin']): ForkOrigin | undefined {
  if (!raw) return undefined;
  const parsed = ForkOriginSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const side = (s: (typeof parsed.data)['ours']): ForkSide | undefined => {
    const op = OpSchema.safeParse(s.op);
    return op.success
      ? { batchId: s.batchId, actor: s.actor, clock: s.clock, op: op.data }
      : undefined;
  };
  const ours = side(parsed.data.ours);
  const theirs = side(parsed.data.theirs);
  if (!ours || !theirs) return undefined;
  return { ...parsed.data, ours, theirs };
}

export function foldBranches(
  batches: readonly Batch[],
  trunkFileId: FileId,
): BranchFold {
  const branches = new Map<BranchId, BranchMeta | ForkMeta>();
  /** fork の別名 → 正の id。自分自身は入れない */
  const alias = new Map<BranchId, BranchId>();
  /** conflictKey → 正の fork の id */
  const forkByKey = new Map<string, BranchId>();
  const trunkCommits: Commit[] = [];
  const branchCommits = new Map<BranchId, Commit[]>();
  const seenCommits = new Set<string>();

  const canonical = (id: BranchId): BranchId => alias.get(id) ?? id;
  /** 削除された id (別名のまま)。解決は最後に行う */
  const removedRaw = new Set<BranchId>();

  // **同じ batch は 1 回だけ畳む。**受信は同じ batch を何度も持ってくるので、重複を
  // そのまま畳むと冪等でなくなる — 1 回目は「まだ居ない branch への setStatus」として
  // 無視された op が、2 回目には居る branch に効いてしまう (性質テストが見つけた反例)。
  // 保存も `UNIQUE(file_id, batch_id)` なので、畳み込みを batch の集合の関数にする
  const seenBatches = new Set<string>();
  for (const batch of orderBatches([...batches])) {
    if (seenBatches.has(batch.id)) continue;
    seenBatches.add(batch.id);
    for (const op of batch.ops) {
      switch (op.kind) {
        case 'branch.create': {
          if (branches.has(op.target) || alias.has(op.target)) break; // 最初の 1 回だけ
          if (op.conflictKey !== undefined) {
            const existing = forkByKey.get(op.conflictKey);
            if (existing !== undefined) {
              alias.set(op.target, existing); // 同じ競合の fork は 1 つに畳む
              break;
            }
            forkByKey.set(op.conflictKey, op.target);
          }
          const meta: BranchMeta = {
            id: op.target,
            name: op.name,
            base: op.base,
            status: BRANCH_STATUS.OPEN,
            sheetId: op.sheetId,
            trunkFileId,
            branchFileId: op.branchFileId,
          };
          const origin = originOf(op.origin);
          branches.set(
            op.target,
            op.conflictKey !== undefined && origin
              ? { ...meta, conflictKey: op.conflictKey, origin }
              : meta,
          );
          break;
        }
        case 'branch.setStatus': {
          const target = branches.get(canonical(op.target));
          if (target) target.status = op.status; // LWW: 後に畳んだものが残る
          break;
        }
        case 'branch.remove':
          removedRaw.add(op.target);
          break;
        case 'commit.add': {
          if (seenCommits.has(op.commit.id)) break;
          seenCommits.add(op.commit.id);
          if (op.branchId === undefined) {
            trunkCommits.push(op.commit);
          } else {
            const id = canonical(op.branchId);
            const list = branchCommits.get(id) ?? [];
            list.push(op.commit);
            branchCommits.set(id, list);
          }
          break;
        }
      }
    }
  }
  // 削除は最後に当てる。別名はここで解決する (上の「削除は最後にまとめて」)
  for (const raw of removedRaw) {
    const id = canonical(raw);
    branches.delete(id);
    branchCommits.delete(id);
  }
  return { branches, trunkCommits, branchCommits };
}
