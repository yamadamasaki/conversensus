/**
 * 「適用不能 op」の計測 (step1 Phase 4d-6, 設計 §1.10 / 受入基準 6)
 *
 * op-log に batch が着地しても、その op が projection へ効いたとは限らない。
 * `projectFile` は未知 sheetId 宛の content batch を**無言で捨て**、対象不在の setter は
 * **無言で no-op になる**。したがって受入基準 1 の「op-log に行が増えた」も、基準 5 の
 * 「両端末の projection が一致する」も、**双方が同じだけ落としていれば成立してしまう**。
 * 落ちた op を直接数えるのがこのモジュールの役目。
 *
 * 判定は `projectFile` / `projectBatches` の畳み込み規則を写したもので、独立した第 2 の
 * 実装である。両者がずれたらテストで気付けるよう、規則の対応関係をコメントで示す。
 */

import type { EdgeId, NodeId, SheetId } from '../schemas';
import { orderBatches } from './project';
import { type Batch, isFileOp, type Op } from './unified';

/** op が projection へ効かなかった理由 */
export type DropReason =
  /** content batch の sheetId が live シート集合に無い (§1.10 の bootstrap ギャップ) */
  | 'unknown-sheet'
  /** content op なのに batch が sheetId を持たない — 宛先不明で projectFile が捨てる */
  | 'no-scope'
  /** setter/reconnect の対象が、その op の適用時点で存在しない */
  | 'missing-target';

/** 落ちなかったが人間に届かない可能性がある op の理由 (FAIL にはしない) */
export type WarnReason =
  /** 既に存在しない対象への remove。冪等な削除なので異常ではない */
  | 'redundant-remove'
  /** 対象ノード/エッジが無いのに置かれた layout・style。孤児として保持されるだけ */
  | 'orphan-decoration';

export type OpTrace = {
  batchId: string;
  clock: number;
  actor: string;
  sheetId: SheetId | undefined;
  kind: Op['kind'];
  /** sheet.reorder / file.* は target を持たない */
  target: string | undefined;
};

export type Drop = OpTrace & { reason: DropReason };
export type Warn = OpTrace & { reason: WarnReason };

export type ApplicabilityReport = {
  /** 検査対象となった op の総数 */
  totalOps: number;
  /** projection へ効いた op の数 */
  appliedOps: number;
  drops: Drop[];
  warns: Warn[];
};

/**
 * 適用時点で対象が存在していなければ no-op になる op。
 * `project.ts` の `applyOp` で `if (node)` / `if (edge)` に守られている分岐に対応する。
 */
const REQUIRES_TARGET: Partial<Record<Op['kind'], 'node' | 'edge'>> = {
  'node.setParent': 'node',
  'node.setContent': 'node',
  'node.setProperties': 'node',
  'edge.reconnect': 'edge',
  'edge.setLabel': 'edge',
  'edge.setProperties': 'edge',
};

/**
 * 対象が無くても Map に書き込まれる op。落ちてはいないが孤児になる。
 * `applyOp` の layout / presentation 分岐 (`prev ?? {}` で必ず set する) に対応する。
 */
const DECORATION: Partial<Record<Op['kind'], 'node' | 'edge'>> = {
  'node.setLayout': 'node',
  'node.setStyle': 'node',
  'edge.setLayout': 'edge',
  'edge.setStyle': 'edge',
  'edge.setLabelOffset': 'edge',
};

/** シート内の live な対象集合。`ProjectedGraph` の nodes/edges の存在だけを追う縮約版 */
type LiveTargets = { nodes: Set<NodeId>; edges: Map<EdgeId, [NodeId, NodeId]> };

function emptyTargets(): LiveTargets {
  return { nodes: new Set(), edges: new Map() };
}

/**
 * 全 batch を畳み込んだ後の live シート集合。`foldFileStructure` の
 * sheet.create (add-wins) / sheet.remove (remove-wins) と同じ規則。
 *
 * `projectFile` は**全 batch を畳み込んだ後の**構造で content をグルーピングするため、
 * content op の宛先判定はこの最終状態で行う (後から作られたシート宛の content も落ちない)。
 * 一方 `sheet.setName` 等は `applyFileOp` が畳み込みの途中で `if (meta)` を見るので、
 * そちらは op 時点の live 集合で判定する (下の `liveNow`)。
 */
function finalLiveSheets(ordered: Batch[]): Set<SheetId> {
  const live = new Set<SheetId>();
  for (const batch of ordered) {
    for (const op of batch.ops) {
      if (op.kind === 'sheet.create') live.add(op.target);
      else if (op.kind === 'sheet.remove') live.delete(op.target);
    }
  }
  return live;
}

/** node.remove のカスケード削除 (`applyOp` の node.remove 分岐と同じ) */
function removeNode(t: LiveTargets, nodeId: NodeId): void {
  t.nodes.delete(nodeId);
  for (const [edgeId, [source, dest]] of t.edges) {
    if (source === nodeId || dest === nodeId) t.edges.delete(edgeId);
  }
}

/**
 * batch 列の各 op が projection へ効いたかを計測する。
 *
 * 呼び出し側 (検査スクリプト) は通常、受信 batch だけでなく**全 batch**を渡す。
 * 対象の存在は自端末の編集も含めた履歴で決まるため、受信分だけを切り出すと
 * 「相手が作ったノードへの自分の setter」が誤って missing-target になる。
 * 受信分だけを見たい場合は `filter` で報告側を絞る。
 */
export function analyzeApplicability(batches: Batch[]): ApplicabilityReport {
  const ordered = orderBatches(batches);
  const sheetsFinal = finalLiveSheets(ordered);
  /** op 時点の live シート集合 (file op の judge 用。畳み込みと同じ順で更新する) */
  const liveNow = new Set<SheetId>();
  const bySheet = new Map<SheetId, LiveTargets>();

  const drops: Drop[] = [];
  const warns: Warn[] = [];
  let totalOps = 0;
  let appliedOps = 0;

  for (const batch of ordered) {
    const base = {
      batchId: batch.id as string,
      clock: batch.clock,
      actor: batch.actor,
      sheetId: batch.sheetId,
    };

    for (const op of batch.ops) {
      totalOps += 1;
      const trace: OpTrace = {
        ...base,
        kind: op.kind,
        target: 'target' in op ? (op.target as string) : undefined,
      };

      // --- file op: シート構造・ファイルメタ。sheetId のスコープに属さない ---
      if (isFileOp(op)) {
        // 未知シートへの setName/setDescription は `applyFileOp` が `if (meta)` で捨てる
        const targetsUnknownSheet =
          (op.kind === 'sheet.setName' || op.kind === 'sheet.setDescription') &&
          !liveNow.has(op.target);
        if (targetsUnknownSheet) {
          drops.push({ ...trace, reason: 'unknown-sheet' });
          continue;
        }
        if (op.kind === 'sheet.create') liveNow.add(op.target);
        else if (op.kind === 'sheet.remove') {
          if (!liveNow.has(op.target))
            warns.push({ ...trace, reason: 'redundant-remove' });
          liveNow.delete(op.target);
        }
        appliedOps += 1;
        continue;
      }

      // --- content op: sheetId のスコープが要る ---
      if (batch.sheetId === undefined) {
        drops.push({ ...trace, reason: 'no-scope' });
        continue;
      }
      if (!sheetsFinal.has(batch.sheetId)) {
        drops.push({ ...trace, reason: 'unknown-sheet' });
        continue;
      }

      const live = bySheet.get(batch.sheetId) ?? emptyTargets();
      bySheet.set(batch.sheetId, live);

      const required = REQUIRES_TARGET[op.kind];
      if (required !== undefined) {
        const exists =
          required === 'node'
            ? live.nodes.has(op.target as NodeId)
            : live.edges.has(op.target as EdgeId);
        if (!exists) {
          drops.push({ ...trace, reason: 'missing-target' });
          continue;
        }
      }

      const decoration = DECORATION[op.kind];
      if (decoration !== undefined) {
        const exists =
          decoration === 'node'
            ? live.nodes.has(op.target as NodeId)
            : live.edges.has(op.target as EdgeId);
        if (!exists) warns.push({ ...trace, reason: 'orphan-decoration' });
      }

      // 存在集合を更新する (`applyOp` の structure 分岐と同じ規則)
      switch (op.kind) {
        case 'node.add':
          live.nodes.add(op.target);
          break;
        case 'node.remove':
          if (!live.nodes.has(op.target))
            warns.push({ ...trace, reason: 'redundant-remove' });
          removeNode(live, op.target);
          break;
        case 'edge.add':
          live.edges.set(op.target, [op.source, op.dest]);
          break;
        case 'edge.remove':
          if (!live.edges.has(op.target))
            warns.push({ ...trace, reason: 'redundant-remove' });
          live.edges.delete(op.target);
          break;
        case 'edge.reconnect':
          live.edges.set(op.target, [op.source, op.dest]);
          break;
      }
      appliedOps += 1;
    }
  }

  return { totalOps, appliedOps, drops, warns };
}
