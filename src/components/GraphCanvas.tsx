import { useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Connection,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useGraphStore } from "../hooks/useGraphStore";
import { CustomNode } from "./CustomNode";
import { CustomEdge } from "./CustomEdge";
import { Toolbar } from "./Toolbar";
import type { GraphNode, GraphEdge } from "../types/graph";
import "./GraphCanvas.css";

const nodeTypes = { customNode: CustomNode };
const edgeTypes = { customEdge: CustomEdge };

/** Map domain GraphNode → React Flow Node */
function toRFNode(n: GraphNode, newlyCreatedNodeId: string | null): Node {
  return {
    id: n.id,
    type: "customNode",
    position: n.position,
    data: {
      content: n.content,
      isNew: n.id === newlyCreatedNodeId,
    },
  };
}

/** Map domain GraphEdge → React Flow Edge */
function toRFEdge(e: GraphEdge): Edge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    type: "customEdge",
    data: { label: e.properties["label"] ?? "" },
  };
}

/** Map React Flow Node back to domain GraphNode (preserving domain fields) */
function fromRFNode(rfNode: Node, existing: GraphNode[]): GraphNode {
  const orig = existing.find((n) => n.id === rfNode.id);
  return {
    id: rfNode.id,
    content: (rfNode.data as { content: string }).content ?? orig?.content ?? "",
    properties: orig?.properties ?? {},
    style: orig?.style ?? {},
    position: rfNode.position,
  };
}

export function GraphCanvas() {
  const { screenToFlowPosition } = useReactFlow();
  const domainNodes = useGraphStore((s) => s.nodes);
  const domainEdges = useGraphStore((s) => s.edges);
  const newlyCreatedNodeId = useGraphStore((s) => s.newlyCreatedNodeId);
  const clearNewlyCreatedNode = useGraphStore((s) => s.clearNewlyCreatedNode);
  const addNode = useGraphStore((s) => s.addNode);
  const addEdgeAction = useGraphStore((s) => s.addEdge);
  const deleteNodes = useGraphStore((s) => s.deleteNodes);
  const deleteEdges = useGraphStore((s) => s.deleteEdges);
  const applyNodeChangesStore = useGraphStore((s) => s.applyNodeChanges);
  const applyEdgeChangesStore = useGraphStore((s) => s.applyEdgeChanges);

  // Convert domain model → React Flow model (memoized)
  // Pass newlyCreatedNodeId so the new node gets isNew:true for auto-focus
  const rfNodes = useMemo(
    () => domainNodes.map((n) => toRFNode(n, newlyCreatedNodeId)),
    [domainNodes, newlyCreatedNodeId]
  );
  const rfEdges = useMemo(() => domainEdges.map(toRFEdge), [domainEdges]);

  // React Flow controlled mode: node changes come back through these handlers
  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      const updated = applyNodeChanges(changes, rfNodes);
      applyNodeChangesStore(updated.map((n) => fromRFNode(n, domainNodes)));
    },
    [rfNodes, domainNodes, applyNodeChangesStore]
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      const updated = applyEdgeChanges(changes, rfEdges);
      // Map back to domain edges
      const domainUpdated: GraphEdge[] = updated.map((e) => {
        const orig = domainEdges.find((d) => d.id === e.id);
        return (
          orig ?? {
            id: e.id,
            source: e.source,
            target: e.target,
            properties: { label: "" },
            style: {},
          }
        );
      });
      applyEdgeChangesStore(domainUpdated);
    },
    [rfEdges, domainEdges, applyEdgeChangesStore]
  );

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      addEdgeAction(connection.source, connection.target);
      // Also apply to RF state so it renders immediately
      applyEdgeChangesStore(
        addEdge(connection, rfEdges).map((e) => {
          const orig = domainEdges.find((d) => d.id === e.id);
          return (
            orig ?? {
              id: e.id,
              source: e.source,
              target: e.target,
              properties: { label: "" },
              style: {},
            }
          );
        })
      );
    },
    [addEdgeAction, rfEdges, domainEdges, applyEdgeChangesStore]
  );

  // Double-click on canvas pane (not on a node/edge) → create node
  const onCanvasDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement;
      // Only trigger when clicking the pane background, not nodes/edges/controls
      if (
        target.classList.contains("react-flow__pane") ||
        target.classList.contains("react-flow__background")
      ) {
        const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
        addNode(position);
        setTimeout(() => clearNewlyCreatedNode(), 100);
      }
    },
    [addNode, screenToFlowPosition, clearNewlyCreatedNode]
  );

  // Delete key handler
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Delete" || event.key === "Backspace") {
        const selectedNodeIds = domainNodes
          .filter((_, i) => rfNodes[i]?.selected)
          .map((n) => n.id);
        const selectedEdgeIds = domainEdges
          .filter((_, i) => rfEdges[i]?.selected)
          .map((e) => e.id);
        if (selectedNodeIds.length) deleteNodes(selectedNodeIds);
        if (selectedEdgeIds.length) deleteEdges(selectedEdgeIds);
      }
    },
    [domainNodes, domainEdges, rfNodes, rfEdges, deleteNodes, deleteEdges]
  );

  const hasSelection =
    rfNodes.some((n) => n.selected) || rfEdges.some((e) => e.selected);

  const handleAddNodeToolbar = useCallback(() => {
    addNode({ x: 200 + Math.random() * 100, y: 200 + Math.random() * 100 });
  }, [addNode]);

  const handleDeleteSelected = useCallback(() => {
    const selectedNodeIds = rfNodes.filter((n) => n.selected).map((n) => n.id);
    const selectedEdgeIds = rfEdges.filter((e) => e.selected).map((e) => e.id);
    if (selectedNodeIds.length) deleteNodes(selectedNodeIds);
    if (selectedEdgeIds.length) deleteEdges(selectedEdgeIds);
  }, [rfNodes, rfEdges, deleteNodes, deleteEdges]);

  return (
    <div className="graph-canvas-container">
      <Toolbar
        onAddNode={handleAddNodeToolbar}
        onDeleteSelected={handleDeleteSelected}
        hasSelection={hasSelection}
      />
      <div
        className="graph-canvas"
        onDoubleClick={onCanvasDoubleClick}
        onKeyDown={onKeyDown}
        tabIndex={0}
      >
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
        >
          <Background variant={BackgroundVariant.Dots} color="#2d4a6e" gap={20} />
          <Controls />
          <MiniMap
            nodeColor="#2d6a9f"
            maskColor="rgba(22, 33, 62, 0.7)"
          />
          {/* Custom arrowhead marker */}
          <svg style={{ position: "absolute", width: 0, height: 0 }}>
            <defs>
              <marker
                id="arrowhead"
                markerWidth="10"
                markerHeight="7"
                refX="10"
                refY="3.5"
                orient="auto"
              >
                <polygon points="0 0, 10 3.5, 0 7" fill="#4a9eda" />
              </marker>
            </defs>
          </svg>
        </ReactFlow>
      </div>
    </div>
  );
}
