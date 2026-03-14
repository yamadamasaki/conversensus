import { describe, it, expect, beforeEach } from "vitest";
import { useGraphStore } from "./useGraphStore";
import { createNewFile } from "../types/graph";

// Reset store before each test
beforeEach(() => {
  useGraphStore.setState({
    file: null,
    fileName: null,
    filePath: null,
    isDirty: false,
    nodes: [],
    edges: [],
  });
});

describe("useGraphStore", () => {
  describe("newFile", () => {
    it("creates a blank file with no nodes or edges", () => {
      useGraphStore.getState().newFile();
      const state = useGraphStore.getState();
      expect(state.nodes).toHaveLength(0);
      expect(state.edges).toHaveLength(0);
      expect(state.isDirty).toBe(false);
      expect(state.fileName).toBe("Untitled");
    });
  });

  describe("loadFile", () => {
    it("loads nodes and edges from a ConversensusFile", () => {
      const file = createNewFile("Test");
      file.sheets[0].nodes = [
        { id: "n1", content: "Hello", properties: {}, style: {}, position: { x: 10, y: 20 } },
      ];
      file.sheets[0].edges = [
        { id: "e1", source: "n1", target: "n1", properties: { label: "self" }, style: {} },
      ];
      useGraphStore.getState().loadFile(file, "/path/to/test.conversensus.json");
      const state = useGraphStore.getState();
      expect(state.nodes).toHaveLength(1);
      expect(state.nodes[0].content).toBe("Hello");
      expect(state.edges).toHaveLength(1);
      expect(state.edges[0].properties["label"]).toBe("self");
      expect(state.isDirty).toBe(false);
      expect(state.fileName).toBe("test.conversensus.json");
    });
  });

  describe("addNode", () => {
    it("adds a node and marks dirty", () => {
      useGraphStore.getState().newFile();
      const node = useGraphStore.getState().addNode({ x: 100, y: 200 });
      const state = useGraphStore.getState();
      expect(state.nodes).toHaveLength(1);
      expect(state.nodes[0].id).toBe(node.id);
      expect(state.nodes[0].position).toEqual({ x: 100, y: 200 });
      expect(state.nodes[0].content).toBe("");
      expect(state.isDirty).toBe(true);
    });

    it("generates unique IDs for multiple nodes", () => {
      useGraphStore.getState().newFile();
      const n1 = useGraphStore.getState().addNode({ x: 0, y: 0 });
      const n2 = useGraphStore.getState().addNode({ x: 10, y: 10 });
      expect(n1.id).not.toBe(n2.id);
    });
  });

  describe("updateNodeContent", () => {
    it("updates content of a specific node", () => {
      useGraphStore.getState().newFile();
      const node = useGraphStore.getState().addNode({ x: 0, y: 0 });
      useGraphStore.getState().updateNodeContent(node.id, "Hello world");
      const updated = useGraphStore.getState().nodes.find((n) => n.id === node.id);
      expect(updated?.content).toBe("Hello world");
    });
  });

  describe("addEdge", () => {
    it("adds an edge between two nodes with empty label", () => {
      useGraphStore.getState().newFile();
      const n1 = useGraphStore.getState().addNode({ x: 0, y: 0 });
      const n2 = useGraphStore.getState().addNode({ x: 100, y: 0 });
      const edge = useGraphStore.getState().addEdge(n1.id, n2.id);
      const state = useGraphStore.getState();
      expect(state.edges).toHaveLength(1);
      expect(state.edges[0].source).toBe(n1.id);
      expect(state.edges[0].target).toBe(n2.id);
      expect(state.edges[0].properties["label"]).toBe("");
      expect(edge.id).toBeTruthy();
    });
  });

  describe("updateEdgeLabel", () => {
    it("updates edge label in properties", () => {
      useGraphStore.getState().newFile();
      const n1 = useGraphStore.getState().addNode({ x: 0, y: 0 });
      const n2 = useGraphStore.getState().addNode({ x: 100, y: 0 });
      const edge = useGraphStore.getState().addEdge(n1.id, n2.id);
      useGraphStore.getState().updateEdgeLabel(edge.id, "causes");
      const updated = useGraphStore.getState().edges.find((e) => e.id === edge.id);
      expect(updated?.properties["label"]).toBe("causes");
    });
  });

  describe("deleteNodes", () => {
    it("removes the node and its connected edges", () => {
      useGraphStore.getState().newFile();
      const n1 = useGraphStore.getState().addNode({ x: 0, y: 0 });
      const n2 = useGraphStore.getState().addNode({ x: 100, y: 0 });
      useGraphStore.getState().addEdge(n1.id, n2.id);
      useGraphStore.getState().deleteNodes([n1.id]);
      const state = useGraphStore.getState();
      expect(state.nodes.find((n) => n.id === n1.id)).toBeUndefined();
      expect(state.nodes.find((n) => n.id === n2.id)).toBeDefined();
      // Edge should be removed because n1 was deleted
      expect(state.edges).toHaveLength(0);
    });
  });

  describe("deleteEdges", () => {
    it("removes only the specified edge", () => {
      useGraphStore.getState().newFile();
      const n1 = useGraphStore.getState().addNode({ x: 0, y: 0 });
      const n2 = useGraphStore.getState().addNode({ x: 100, y: 0 });
      const edge = useGraphStore.getState().addEdge(n1.id, n2.id);
      useGraphStore.getState().deleteEdges([edge.id]);
      expect(useGraphStore.getState().edges).toHaveLength(0);
      // Nodes should remain
      expect(useGraphStore.getState().nodes).toHaveLength(2);
    });
  });

  describe("updateNodePosition", () => {
    it("updates position and marks dirty", () => {
      useGraphStore.getState().newFile();
      const node = useGraphStore.getState().addNode({ x: 0, y: 0 });
      useGraphStore.getState().updateNodePosition(node.id, { x: 300, y: 400 });
      const updated = useGraphStore.getState().nodes.find((n) => n.id === node.id);
      expect(updated?.position).toEqual({ x: 300, y: 400 });
      expect(useGraphStore.getState().isDirty).toBe(true);
    });
  });
});
