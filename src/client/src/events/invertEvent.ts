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
      };
    case 'NODE_DELETED':
      return {
        ...base,
        type: 'NODE_ADDED',
        category: 'structure',
        nodeId: event.nodeId,
        data: event.data,
      };
    case 'EDGE_ADDED':
      return {
        ...base,
        type: 'EDGE_DELETED',
        category: 'structure',
        edgeId: event.edgeId,
        data: event.data,
      };
    case 'EDGE_DELETED':
      return {
        ...base,
        type: 'EDGE_ADDED',
        category: 'structure',
        edgeId: event.edgeId,
        data: event.data,
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
    case 'NODES_GROUPED':
      return {
        ...base,
        type: 'NODES_UNGROUPED',
        category: 'structure',
        parentId: event.parentId,
        parentData: event.parentData,
        children: event.children,
      };
    case 'NODES_UNGROUPED':
      return {
        ...base,
        type: 'NODES_GROUPED',
        category: 'structure',
        parentId: event.parentId,
        parentData: event.parentData,
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
        edges: event.edges,
      };
    case 'NODES_PASTED_UNDO':
      return {
        ...base,
        type: 'NODES_PASTED',
        category: 'structure',
        nodes: event.nodes,
        edges: event.edges,
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
