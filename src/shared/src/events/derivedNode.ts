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

import type { GraphNode, NodeId, SheetId } from '../schemas';
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
