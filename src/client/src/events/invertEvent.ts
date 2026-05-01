import type { GraphEvent } from './GraphEvent';
import { makeEventBase } from './GraphEvent';

export function invertEvent(event: GraphEvent): GraphEvent {
  const base = makeEventBase(event.category);
  switch (event.type) {
    case 'NODE_ADDED':
      return {
        ...base,
        type: 'NODE_DELETED',
        category: 'structure',
        nodeId: event.nodeId,
        data: event.data,
        layout: event.layout,
      };
    case 'NODE_DELETED':
      return {
        ...base,
        type: 'NODE_ADDED',
        category: 'structure',
        nodeId: event.nodeId,
        data: event.data,
        layout: event.layout,
      };
    case 'EDGE_ADDED':
      return {
        ...base,
        type: 'EDGE_DELETED',
        category: 'structure',
        edgeId: event.edgeId,
        data: event.data,
        edgeLayout: event.edgeLayout,
      };
    case 'EDGE_DELETED':
      return {
        ...base,
        type: 'EDGE_ADDED',
        category: 'structure',
        edgeId: event.edgeId,
        data: event.data,
        edgeLayout: event.edgeLayout,
      };
    case 'EDGE_RECONNECTED':
      return {
        ...base,
        type: 'EDGE_RECONNECTED',
        category: 'structure',
        edgeId: event.edgeId,
        from: event.to,
        to: event.from,
      };
    case 'NODE_REPARENTED':
      return {
        ...base,
        type: 'NODE_REPARENTED',
        category: 'structure',
        nodeId: event.nodeId,
        oldParentId: event.newParentId,
        newParentId: event.oldParentId,
        oldPosition: event.newPosition,
        newPosition: event.oldPosition,
      };
    case 'NODES_GROUPED':
      return {
        ...base,
        type: 'NODES_UNGROUPED',
        category: 'structure',
        parentId: event.parentId,
        parentData: event.parentData,
        parentLayout: event.parentLayout,
        children: event.children,
      };
    case 'NODES_UNGROUPED':
      return {
        ...base,
        type: 'NODES_GROUPED',
        category: 'structure',
        parentId: event.parentId,
        parentData: event.parentData,
        parentLayout: event.parentLayout,
        children: event.children,
      };
    case 'NODES_PASTED':
      return {
        ...base,
        type: 'NODES_PASTED_UNDO',
        category: 'structure',
        nodeIds: event.nodes.map((n) => n.id),
        edgeIds: event.edges.map((e) => e.id),
        nodes: event.nodes,
        layouts: event.layouts,
        edges: event.edges,
        edgeLayouts: event.edgeLayouts,
      };
    case 'NODES_PASTED_UNDO':
      return {
        ...base,
        type: 'NODES_PASTED',
        category: 'structure',
        nodes: event.nodes,
        layouts: event.layouts,
        edges: event.edges,
        edgeLayouts: event.edgeLayouts,
      };
    case 'NODE_RELABELED':
      return {
        ...base,
        type: 'NODE_RELABELED',
        category: 'content',
        nodeId: event.nodeId,
        from: event.to,
        to: event.from,
      };
    case 'EDGE_RELABELED':
      return {
        ...base,
        type: 'EDGE_RELABELED',
        category: 'content',
        edgeId: event.edgeId,
        from: event.to,
        to: event.from,
      };
    case 'NODE_MOVED':
      return {
        ...base,
        type: 'NODE_MOVED',
        category: 'layout',
        nodeId: event.nodeId,
        from: event.to,
        to: event.from,
      };
    case 'NODE_RESIZED':
      return {
        ...base,
        type: 'NODE_RESIZED',
        category: 'layout',
        nodeId: event.nodeId,
        from: event.to,
        to: event.from,
      };
    case 'EDGE_STYLE_CHANGED':
      return {
        ...base,
        type: 'EDGE_STYLE_CHANGED',
        category: 'presentation',
        edgeId: event.edgeId,
        from: event.to,
        to: event.from,
      };
    case 'NODE_STYLE_CHANGED':
      return {
        ...base,
        type: 'NODE_STYLE_CHANGED',
        category: 'presentation',
        nodeId: event.nodeId,
        from: event.to,
        to: event.from,
      };
    case 'EDGE_LABEL_MOVED':
      return {
        ...base,
        type: 'EDGE_LABEL_MOVED',
        category: 'presentation',
        edgeId: event.edgeId,
        from: event.to,
        to: event.from,
      };
    case 'NODE_PROPERTIES_CHANGED':
      return {
        ...base,
        type: 'NODE_PROPERTIES_CHANGED',
        category: 'content',
        nodeId: event.nodeId,
        from: event.to,
        to: event.from,
      };
    case 'EDGE_PROPERTIES_CHANGED':
      return {
        ...base,
        type: 'EDGE_PROPERTIES_CHANGED',
        category: 'content',
        edgeId: event.edgeId,
        from: event.to,
        to: event.from,
      };
  }
}
