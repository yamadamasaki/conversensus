/**
 * merger の「取り込む」(step3 Phase 5 S5-1c, 仕様 merger / Q9)
 *
 * merge 元・先の pane で選んだ要素を、**merge 後の姿をその pane の姿に揃える** event の列にする。
 * merge 後の canvas の dispatch を通すので、undo / redo できる (仕様: どの操作も undo/redo 対象)。
 *
 * 揃えるのは要素ごとに: 在否・本文・名前 (label)・プロパティ・位置。edge を取り込むとき、端の node が
 * merge 後に無ければ一緒に取り込む (端の無い edge は描けない)。node を消すときは、merge 後でその node に
 * 繋がっている edge を先に消す
 */

import type {
  EdgeId,
  GraphEdge,
  GraphNode,
  NodeId,
  NodeLayout,
  Sheet,
} from '@conversensus/shared';
import { type GraphEvent, makeEventBase } from '../events/GraphEvent';

const sameProperties = (
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

export function alignToPane(
  result: Sheet,
  pane: Sheet,
  ids: readonly string[],
): GraphEvent[] {
  const events: GraphEvent[] = [];
  const nodesNow = new Map(result.nodes.map((n) => [n.id as string, n]));
  const edgesNow = new Map(result.edges.map((e) => [e.id as string, e]));
  const layoutOf = (sheet: Sheet, id: string): NodeLayout | undefined =>
    sheet.layouts?.find((l) => l.nodeId === id);
  const paneNode = (id: string) => pane.nodes.find((n) => n.id === id);
  const paneEdge = (id: string) => pane.edges.find((e) => e.id === id);

  const addNode = (node: GraphNode) => {
    const layout = layoutOf(pane, node.id);
    events.push({
      ...makeEventBase('structure'),
      type: 'NODE_ADDED',
      nodeId: node.id as NodeId,
      data: node,
      ...(layout && { layout }),
    });
    nodesNow.set(node.id, node);
  };
  const removeEdge = (edge: GraphEdge) => {
    const edgeLayout = result.edgeLayouts?.find((l) => l.edgeId === edge.id);
    events.push({
      ...makeEventBase('structure'),
      type: 'EDGE_DELETED',
      edgeId: edge.id as EdgeId,
      data: edge,
      ...(edgeLayout && { edgeLayout }),
    });
    edgesNow.delete(edge.id);
  };

  const alignNode = (id: string, want: GraphNode | undefined) => {
    const have = nodesNow.get(id);
    if (want && !have) {
      addNode(want);
      return;
    }
    if (!want && have) {
      // 繋がっている edge を先に消す (端の無い edge を残さない)
      for (const edge of [...edgesNow.values()]) {
        if (edge.source === id || edge.target === id) removeEdge(edge);
      }
      const layout = layoutOf(result, id);
      events.push({
        ...makeEventBase('structure'),
        type: 'NODE_DELETED',
        nodeId: id as NodeId,
        data: have,
        ...(layout && { layout }),
      });
      nodesNow.delete(id);
      return;
    }
    if (!want || !have) return;
    const nodeId = id as NodeId;
    if (have.content !== want.content) {
      events.push({
        ...makeEventBase('content'),
        type: 'NODE_CONTENT_CHANGED',
        nodeId,
        from: have.content,
        to: want.content,
      });
    }
    if ((have.label ?? '') !== (want.label ?? '')) {
      events.push({
        ...makeEventBase('content'),
        type: 'NODE_LABEL_CHANGED',
        nodeId,
        from: have.label ?? '',
        to: want.label ?? '',
      });
    }
    if (!sameProperties(have.properties, want.properties)) {
      events.push({
        ...makeEventBase('content'),
        type: 'NODE_PROPERTIES_CHANGED',
        nodeId,
        from: { ...(have.properties ?? {}) },
        to: { ...(want.properties ?? {}) },
      });
    }
    const from = layoutOf(result, id);
    const to = layoutOf(pane, id);
    if (to && (from?.x !== to.x || from?.y !== to.y)) {
      events.push({
        ...makeEventBase('layout'),
        type: 'NODE_MOVED',
        nodeId,
        from: { x: from?.x ?? 0, y: from?.y ?? 0 },
        to: { x: to.x ?? 0, y: to.y ?? 0 },
      });
    }
  };

  const alignEdge = (id: string, want: GraphEdge | undefined) => {
    const have = edgesNow.get(id);
    if (want && !have) {
      // 端の node が merge 後に無ければ一緒に取り込む
      for (const end of [want.source, want.target]) {
        const node = paneNode(end);
        if (!nodesNow.has(end) && node) addNode(node);
      }
      if (!nodesNow.has(want.source) || !nodesNow.has(want.target)) return;
      const edgeLayout = pane.edgeLayouts?.find((l) => l.edgeId === id);
      events.push({
        ...makeEventBase('structure'),
        type: 'EDGE_ADDED',
        edgeId: id as EdgeId,
        data: want,
        ...(edgeLayout && { edgeLayout }),
      });
      edgesNow.set(id, want);
      return;
    }
    if (!want && have) {
      removeEdge(have);
      return;
    }
    if (!want || !have) return;
    const edgeId = id as EdgeId;
    if ((have.label ?? '') !== (want.label ?? '')) {
      events.push({
        ...makeEventBase('content'),
        type: 'EDGE_RELABELED',
        edgeId,
        from: have.label ?? '',
        to: want.label ?? '',
      });
    }
    if (!sameProperties(have.properties, want.properties)) {
      events.push({
        ...makeEventBase('content'),
        type: 'EDGE_PROPERTIES_CHANGED',
        edgeId,
        from: { ...(have.properties ?? {}) },
        to: { ...(want.properties ?? {}) },
      });
    }
  };

  for (const id of ids) {
    const isNode = nodesNow.has(id) || paneNode(id) !== undefined;
    if (isNode) alignNode(id, paneNode(id));
    else alignEdge(id, paneEdge(id));
  }
  return events;
}
