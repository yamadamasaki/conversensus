/**
 * metagraph 上の操作をシートの操作に読み替える (step3 Phase 4 S4-2, architecture step3 §3.2 D2)
 *
 * metagraph の graph node (導出 node) は sheet の一覧から導くもので、node の op では変わらない
 * (畳み込みが導出 node への `node.setContent` / `node.remove` を無視する)。画面で graph node を消す・
 * 書き換えるのは、**シートを消す・名前を変える**ことである。
 *
 * ここは `GraphEditor` が dispatch しようとした event を 2 つに分ける:
 *
 * - `intents`: シートの操作 (シートを消す・名前を変える)。**undo の積み上げに入れない** — シートの
 *   削除は undo で戻せない (中身ごと消える)
 * - `rest`: 残りのふつうの操作 (graph node 以外の node・edge)。今までどおり dispatch する。
 *   残りが無ければ null
 */

import type { NodeId, SheetId } from '@conversensus/shared';
import type { GraphEvent } from '../events/GraphEvent';

export type MetagraphIntent =
  | { kind: 'removeSheet'; sheetId: SheetId }
  | { kind: 'renameSheet'; sheetId: SheetId; name: string };

export type SplitMetagraphEvent = {
  rest: GraphEvent | null;
  intents: MetagraphIntent[];
};

/**
 * @param sheetOf graph node ならその sheet、そうでなければ undefined
 */
export function splitMetagraphEvent(
  event: GraphEvent,
  sheetOf: (nodeId: NodeId) => SheetId | undefined,
): SplitMetagraphEvent {
  switch (event.type) {
    case 'NODES_DELETED': {
      const graphNodeIds = event.nodeIds.filter((id) => sheetOf(id));
      if (graphNodeIds.length === 0) return { rest: event, intents: [] };
      const intents = graphNodeIds.map(
        (id): MetagraphIntent => ({
          kind: 'removeSheet',
          sheetId: sheetOf(id) as SheetId,
        }),
      );
      const kept = new Set(event.nodeIds.filter((id) => !sheetOf(id)));
      // graph node を端にする edge も残りに含める — シートが消えれば畳み込みでも消えるが、
      // シートの削除を取り消した (確認で断った) ときに edge だけ残すのは利用者の意図どおり
      const rest =
        kept.size === 0 && event.edgeIds.length === 0
          ? null
          : {
              ...event,
              nodeIds: [...kept],
              nodes: event.nodes.filter((n) => kept.has(n.id)),
              layouts: event.layouts.filter((l) => kept.has(l.nodeId)),
            };
      return { rest, intents };
    }
    case 'NODE_CONTENT_CHANGED': {
      const sheetId = sheetOf(event.nodeId);
      if (!sheetId) return { rest: event, intents: [] };
      const name = event.to.trim();
      // 空の名前にはしない (シートの名前は空を許さない画面の約束に揃える)
      return {
        rest: null,
        intents: name === '' ? [] : [{ kind: 'renameSheet', sheetId, name }],
      };
    }
    case 'NODE_LABEL_CHANGED':
    case 'NODE_PROPERTIES_CHANGED':
      // graph node の label・プロパティは持たない (名前と在否の正は sheet 側)。黙って捨てる
      return sheetOf(event.nodeId)
        ? { rest: null, intents: [] }
        : { rest: event, intents: [] };
    default:
      return { rest: event, intents: [] };
  }
}
