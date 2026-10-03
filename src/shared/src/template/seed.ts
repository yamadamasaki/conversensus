/**
 * template の表 → template graph (step3 Phase 4 S4-1c)
 *
 * 種 (`SEED_TEMPLATES`) を File に複製するときに使う。`templateFromSheet` の逆向きで、
 * **往復すると同じ種類に戻る** (性質テストで固める):
 *
 * - node の種類 → label = 種類名、本文 = 説明、property = 既定値 の node
 * - edge の種類 → 端の種類の node どうしを繋ぐ edge (label = 種類名、property = 既定値)。端が複数なら
 *   組ごとに 1 本。端が「任意」なら、label の無い node (「任意の node」) を 1 つ置いてそこへ繋ぐ
 *
 * 置き場所は格子にする (種類の並びの順)。利用者が後で動かす
 */

import type {
  EdgeId,
  EdgeLayout,
  GraphEdge,
  GraphNode,
  NodeId,
  NodeLayout,
} from '../schemas';
import { ANY_NODE_KIND, type Template } from './types';

export type TemplateGraphContent = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  layouts: NodeLayout[];
  edgeLayouts: EdgeLayout[];
};

/** 格子の間隔と列の数。node の既定の大きさ (160 × 80) が重ならない値 */
const GRID_X = 240;
const GRID_Y = 160;
const GRID_COLUMNS = 3;
/** 「任意の node」の本文 (label を持たないので種類にはならない。使い方の説明を兼ねる) */
const ANY_NODE_CONTENT = '(この template に無い、任意の種類の node)';

export function templateGraphOf(
  template: Template,
  newId: () => string,
): TemplateGraphContent {
  const nodes: GraphNode[] = [];
  const idOfKind = new Map<string, NodeId>();
  for (const kind of template.nodeKinds) {
    const id = newId() as NodeId;
    idOfKind.set(kind.id, id);
    nodes.push({
      id,
      content: kind.description ?? '',
      label: kind.label,
      ...(Object.keys(kind.defaults).length > 0 && {
        properties: { ...kind.defaults },
      }),
    });
  }
  const anyEnd = () => {
    let id = idOfKind.get(ANY_NODE_KIND);
    if (!id) {
      id = newId() as NodeId;
      idOfKind.set(ANY_NODE_KIND, id);
      nodes.push({ id, content: ANY_NODE_CONTENT });
    }
    return id;
  };
  const endOf = (kindId: string) =>
    kindId === ANY_NODE_KIND ? anyEnd() : (idOfKind.get(kindId) as NodeId);

  const edges: GraphEdge[] = [];
  for (const kind of template.edgeKinds) {
    for (const from of kind.from) {
      for (const to of kind.to) {
        edges.push({
          id: newId() as EdgeId,
          source: endOf(from),
          target: endOf(to),
          ...(kind.label !== '' && { label: kind.label }),
          ...(Object.keys(kind.defaults).length > 0 && {
            properties: { ...kind.defaults },
          }),
        });
      }
    }
  }

  const layouts: NodeLayout[] = nodes.map((n, i) => ({
    nodeId: n.id,
    x: (i % GRID_COLUMNS) * GRID_X,
    y: Math.floor(i / GRID_COLUMNS) * GRID_Y,
  }));
  const edgeLayouts: EdgeLayout[] = edges.map((e) => ({ edgeId: e.id }));
  return { nodes, edges, layouts, edgeLayouts };
}
