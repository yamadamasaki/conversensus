import type { Edge, Node } from '@xyflow/react';
import {
  recalculateParentBounds,
  toFlowEdges,
  toFlowNodes,
} from '../graphTransform';
import type { GraphEvent } from './GraphEvent';

export function applyEvent(
  event: GraphEvent,
  nodes: Node[],
  edges: Edge[],
): { nodes: Node[]; edges: Edge[] } {
  switch (event.type) {
    case 'NODE_ADDED':
      return {
        nodes: [
          ...nodes,
          toFlowNodes([event.data], event.layout ? [event.layout] : [])[0],
        ],
        edges,
      };

    case 'NODE_DELETED':
      return {
        nodes: nodes.filter((n) => n.id !== event.nodeId),
        edges: edges.filter(
          (e) => e.source !== event.nodeId && e.target !== event.nodeId,
        ),
      };

    case 'EDGE_ADDED':
      return {
        nodes,
        edges: [
          ...edges,
          toFlowEdges(
            [event.data],
            event.edgeLayout ? [event.edgeLayout] : [],
          )[0],
        ],
      };

    case 'EDGE_DELETED':
      return {
        nodes,
        edges: edges.filter((e) => e.id !== event.edgeId),
      };

    case 'EDGE_RECONNECTED':
      return {
        nodes,
        edges: edges.map((e) =>
          e.id === event.edgeId
            ? {
                ...e,
                source: event.to.source,
                target: event.to.target,
                sourceHandle: event.to.sourceHandle ?? null,
                targetHandle: event.to.targetHandle ?? null,
                data: {
                  ...e.data,
                  labelOffsetX: 0,
                  labelOffsetY: 0,
                },
              }
            : e,
        ),
      };

    case 'NODE_REPARENTED': {
      const withUpdated = nodes.map((n) =>
        n.id !== event.nodeId
          ? n
          : { ...n, parentId: event.newParentId, position: event.newPosition },
      );
      if (!event.newParentId) {
        return { nodes: recalculateParentBounds(withUpdated), edges };
      }
      const parentIdx = withUpdated.findIndex(
        (n) => n.id === event.newParentId,
      );
      const nodeIdx = withUpdated.findIndex((n) => n.id === event.nodeId);
      if (nodeIdx > parentIdx) {
        return { nodes: recalculateParentBounds(withUpdated), edges };
      }
      // ノードが親より前にある場合、親の直後に移動する
      const node = withUpdated[nodeIdx];
      const withoutNode = withUpdated.filter((n) => n.id !== event.nodeId);
      const newParentIdx = withoutNode.findIndex(
        (n) => n.id === event.newParentId,
      );
      withoutNode.splice(newParentIdx + 1, 0, node);
      return { nodes: recalculateParentBounds(withoutNode), edges };
    }

    case 'NODES_GROUPED': {
      const parentNode = toFlowNodes(
        [event.parentData],
        [event.parentLayout],
      )[0];
      const childMap = new Map(event.children.map((c) => [c.nodeId, c]));
      const updatedNodes = nodes.map((n) => {
        const child = childMap.get(n.id as typeof event.parentId);
        if (!child) return n;
        return {
          ...n,
          parentId: event.parentId,
          selected: false,
          position: child.newPosition,
        };
      });
      const firstChildIdx = updatedNodes.findIndex((n) =>
        childMap.has(n.id as typeof event.parentId),
      );
      const insertAt = firstChildIdx >= 0 ? firstChildIdx : 0;
      return {
        nodes: [
          ...updatedNodes.slice(0, insertAt),
          parentNode,
          ...updatedNodes.slice(insertAt),
        ],
        edges,
      };
    }

    case 'NODES_UNGROUPED': {
      const childMap = new Map(event.children.map((c) => [c.nodeId, c]));
      return {
        nodes: nodes
          .filter((n) => n.id !== event.parentId)
          .map((n) => {
            const child = childMap.get(n.id as typeof event.parentId);
            if (!child) return n;
            return {
              ...n,
              parentId: child.originalParentId,
              position: child.originalPosition,
            };
          }),
        edges,
      };
    }

    case 'NODES_PASTED': {
      const newNodes = toFlowNodes(event.nodes, event.layouts);
      const newEdges = toFlowEdges(event.edges, event.edgeLayouts);
      return {
        nodes: [...nodes.map((n) => ({ ...n, selected: false })), ...newNodes],
        edges: [...edges, ...newEdges],
      };
    }

    case 'NODES_PASTED_UNDO': {
      const nodeIdSet = new Set(event.nodeIds as string[]);
      const edgeIdSet = new Set(event.edgeIds as string[]);
      return {
        nodes: nodes.filter((n) => !nodeIdSet.has(n.id)),
        edges: edges.filter((e) => !edgeIdSet.has(e.id)),
      };
    }

    case 'NODE_RELABELED':
      return {
        nodes: nodes.map((n) =>
          n.id === event.nodeId
            ? { ...n, data: { ...n.data, label: event.to } }
            : n,
        ),
        edges,
      };

    case 'EDGE_RELABELED':
      return {
        nodes,
        edges: edges.map((e) =>
          e.id === event.edgeId ? { ...e, label: event.to } : e,
        ),
      };

    case 'NODE_MOVED':
      return {
        nodes: nodes.map((n) =>
          n.id === event.nodeId ? { ...n, position: event.to } : n,
        ),
        edges,
      };

    case 'NODE_RESIZED':
      return {
        nodes: recalculateParentBounds(
          nodes.map((n) =>
            n.id === event.nodeId
              ? {
                  ...n,
                  style: {
                    ...n.style,
                    width: event.to.width,
                    height: event.to.height,
                  },
                }
              : n,
          ),
        ),
        edges,
      };

    case 'EDGE_STYLE_CHANGED':
      return {
        nodes,
        edges: edges.map((e) =>
          e.id === event.edgeId
            ? { ...e, data: { ...e.data, ...event.to } }
            : e,
        ),
      };

    case 'NODE_STYLE_CHANGED': {
      const { width, height } = event.to;
      return {
        nodes: nodes.map((n) =>
          n.id === event.nodeId
            ? {
                ...n,
                style: {
                  ...n.style,
                  ...(width !== undefined ? { width } : {}),
                  ...(height !== undefined ? { height } : {}),
                },
              }
            : n,
        ),
        edges,
      };
    }

    case 'EDGE_LABEL_MOVED':
      return {
        nodes,
        edges: edges.map((e) =>
          e.id === event.edgeId
            ? {
                ...e,
                data: {
                  ...e.data,
                  labelOffsetX: event.to.offsetX,
                  labelOffsetY: event.to.offsetY,
                },
              }
            : e,
        ),
      };

    case 'NODE_PROPERTIES_CHANGED':
      return {
        nodes: nodes.map((n) =>
          n.id === event.nodeId
            ? {
                ...n,
                data: {
                  ...n.data,
                  properties: {
                    ...(n.data.properties ?? {}),
                    ...event.to,
                  },
                },
              }
            : n,
        ),
        edges,
      };

    case 'EDGE_PROPERTIES_CHANGED':
      return { nodes, edges };

    default:
      return { nodes, edges };
  }
}
