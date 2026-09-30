/**
 * canvas の変化のうち、**グラフの中身が変わったものだけ**を親へ通す門 (step3 Phase 0 S0-2)。
 *
 * React Flow の nodes/edges は、中身の編集以外でも変わる — 寸法の計測 (`measured`)、
 * 差分の色 (`diffType` / edge の `style`)、選択。以前はこれを 2 つの仕掛けで捨てていた。
 *
 * - `readyForSave`: 再 seed の後 150ms は**時間で**すべて捨てる
 * - `conflictUpdatePendingRef`: 色を塗ったら次の 1 回を捨てる
 *
 * どちらも**出どころではなく時刻・回数で見分けていた**ので、利用者の編集が窓に入ると
 * 一緒に捨てられた。branch を開いてすぐ置いたノードが canvas には出るのに「(N 変更)」に
 * 数えられずコミットできない、という step2 T7-7 の未修正の不具合がこれである
 * (App 結合テストで再現: 開いてから 150ms 以内の編集で起きる)。
 *
 * ここでは**中身で**見分ける。`fromFlowNodes` / `fromFlowEdges` が読むのは op に落ちる値
 * (位置・style の幅と高さ・content・label・properties・端点・経路) だけで、計測・色・選択は
 * 読まない。したがってその射影が前回と同じなら、親へ伝えるべき変化は無い。
 */

import type { Edge, Node } from '@xyflow/react';
import { fromFlowEdges, fromFlowNodes } from '../graphTransform';

/** canvas の中身 (op に落ちる値) の射影。ゴーストは保存対象ではないので除く */
export function contentOf(nodes: Node[], edges: Edge[]) {
  const { nodes: graphNodes, layouts } = fromFlowNodes(
    nodes.filter((n) => !n.data?.ghost),
  );
  const { edges: graphEdges, edgeLayouts } = fromFlowEdges(
    edges.filter((e) => !e.data?.ghost),
  );
  return { nodes: graphNodes, layouts, edges: graphEdges, edgeLayouts };
}

export type CanvasContent = ReturnType<typeof contentOf>;

/**
 * 射影の同一性の鍵。**要素の並びも含める** — 並びは描画順 (group の子が親より後) に
 * 効くので、並べ替えだけの変化も中身の変化として扱う
 */
function keyOf(content: CanvasContent): string {
  return JSON.stringify(content);
}

export type ChangeGate = {
  /** 親から受け取った中身で canvas を置き直した。これは親が既に知っている中身である */
  seed: (content: CanvasContent) => void;
  /** 中身が前回 (seed または通した変化) と違えば true を返し、それを新しい基準にする */
  admit: (content: CanvasContent) => boolean;
};

export function createChangeGate(): ChangeGate {
  let last: string | null = null;
  return {
    seed: (content) => {
      last = keyOf(content);
    },
    admit: (content) => {
      const key = keyOf(content);
      if (key === last) return false;
      last = key;
      return true;
    },
  };
}
