/**
 * 導出 node (step3 Phase 1 D8 / architecture step3 §3.2 D2)
 *
 * metagraph の graph node は op として積まず、**File の sheet の一覧から導出する**。
 * 保存するのは位置 (`node.setLayout`) と、graph node を端点にする edge だけである。
 *
 * - 名前の正は sheet 側の 1 つだけ (`sheet.setName`)。導出 node の content は sheet の名前で、
 *   導出 node への `node.setContent` などは畳み込みが無視する
 * - graph node の追加・削除は `sheet.create` / `sheet.remove` そのもの。「全 metagraph に
 *   op を積む」並行性の問題が構造上起きない
 *
 * **導出 node の id は SheetId から決定的に作る** (U4)。端点に SheetId を直接許す案もあったが、
 * NodeId の型と edge のスキーマを変えずに済む方を採った。
 */

import type { GraphNode, NodeId, Sheet, SheetId } from '../schemas';
import { deterministicUuid } from './genesis';
import type { PropertyName } from './unified';

/** 導出 node が、どの sheet から導出されたかを載せるプロパティ */
export const DERIVED_FROM_SHEET_PROPERTY: PropertyName =
  'app.conversensus.derivedFromSheet';

/** sheet の導出 node の id。**誰の手元でも同じ id になる** */
export function derivedNodeIdOf(sheetId: SheetId): NodeId {
  return deterministicUuid(`derived-node:${sheetId}`) as NodeId;
}

/**
 * ある metagraph の畳み込みに渡す導出 node。
 *
 * - `live`: いま在る sheet の導出 node。畳み込みの最後に node として出る
 * - `vanished`: 作られたが今は無い sheet の導出 node の id。その id への `node.add` を
 *   ふつうの node として採らないために要る。layout と edge は、metagraph では「端点が live な
 *   node か」で判定するので (`projectBatches`)、これに頼らない
 */
export type DerivedNodes = {
  live: ReadonlyMap<NodeId, GraphNode>;
  vanished: ReadonlySet<NodeId>;
};

/**
 * metagraph に出す導出 node を求める。
 *
 * @param shown   導出 node にする sheet (いま在るもの)。名前が content になる
 * @param created この File で一度でも作られた sheet。`shown` に無いものが `vanished` になる
 */
export function derivedNodesFor(
  shown: readonly { id: SheetId; name: string }[],
  created: Iterable<SheetId>,
): DerivedNodes {
  const live = new Map<NodeId, GraphNode>();
  for (const sheet of shown) {
    const id = derivedNodeIdOf(sheet.id);
    live.set(id, {
      id,
      content: sheet.name,
      properties: { [DERIVED_FROM_SHEET_PROPERTY]: sheet.id },
    });
  }
  const vanished = new Set<NodeId>();
  for (const sheetId of created) {
    const id = derivedNodeIdOf(sheetId);
    if (!live.has(id)) vanished.add(id);
  }
  return { live, vanished };
}

/** その id が導出 node のもの (いま在るか、消えたか) か */
export function isDerivedNodeId(derived: DerivedNodes, id: NodeId): boolean {
  return derived.live.has(id) || derived.vanished.has(id);
}

/**
 * metagraph の姿を、**いまの sheet の一覧**で導き直す (step3 Phase 4 S4-2)。
 *
 * projection は読み込んだ時点の一覧で導出 node を作る。画面がその後で sheet を足す・消す・名前を
 * 変えると、手元の姿は古くなる (自分の書き込みでは projection し直さない)。導出 node だけを
 * 一覧から作り直し、消えた sheet の導出 node を端点にする edge とその layout を外す
 * (`projectBatches` の「端点が live な node である edge だけを live にする」と同じ規則)。
 *
 * **一覧が projection と同じなら、projection の姿そのものに戻る** (性質テストで固める)
 */
export function refreshDerivedNodes(
  sheet: Sheet,
  sheets: readonly { id: SheetId; name: string }[],
): Sheet {
  const isDerived = (node: GraphNode) =>
    node.properties?.[DERIVED_FROM_SHEET_PROPERTY] !== undefined;
  const live = derivedNodesFor(sheets, []).live;
  const nodes = [...sheet.nodes.filter((n) => !isDerived(n)), ...live.values()];
  const ids = new Set<string>(nodes.map((n) => n.id));
  return {
    ...sheet,
    nodes,
    edges: sheet.edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
    ...(sheet.layouts && {
      layouts: sheet.layouts.filter((l) => ids.has(l.nodeId)),
    }),
    ...(sheet.edgeLayouts && {
      edgeLayouts: sheet.edgeLayouts.filter((l) =>
        sheet.edges.some(
          (e) => e.id === l.edgeId && ids.has(e.source) && ids.has(e.target),
        ),
      ),
    }),
  };
}

/** 置き場所の無い導出 node を並べる格子の間隔と列の数 (node の既定の大きさ 160 × 80 が重ならない) */
const PLACE_X = 220;
const PLACE_Y = 140;
const PLACE_COLUMNS = 4;

/**
 * 置き場所 (layout) の無い導出 node を、既にある要素の下に格子に並べる (step3 Phase 4, 仕様: 配置は
 * システムに任せる)。**op は積まない** — view の側で置くだけで、利用者が動かした時に初めて
 * `node.setLayout` が載る。並びは node の順 (sheet の並び)
 */
export function placeDerivedNodes(sheet: Sheet): Sheet {
  const layouts = sheet.layouts ?? [];
  const placed = new Set<string>(layouts.map((l) => l.nodeId));
  const unplaced = sheet.nodes.filter(
    (n) =>
      n.properties?.[DERIVED_FROM_SHEET_PROPERTY] !== undefined &&
      !placed.has(n.id),
  );
  if (unplaced.length === 0) return sheet;
  const top =
    layouts.length === 0
      ? 0
      : Math.max(...layouts.map((l) => l.y ?? 0)) + PLACE_Y;
  return {
    ...sheet,
    layouts: [
      ...layouts,
      ...unplaced.map((n, i) => ({
        nodeId: n.id,
        x: (i % PLACE_COLUMNS) * PLACE_X,
        y: top + Math.floor(i / PLACE_COLUMNS) * PLACE_Y,
      })),
    ],
  };
}
