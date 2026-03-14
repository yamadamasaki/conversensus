import { create } from "zustand";
import type { GraphNode, GraphEdge, ConversensusFile, Sheet } from "../types/graph";
import { createNewFile } from "../types/graph";
import { nanoid } from "nanoid";

interface GraphState {
  // Current file data
  file: ConversensusFile | null;
  fileName: string | null; // Display name for title bar
  filePath: string | null; // Actual path on disk
  isDirty: boolean;

  // Derived helpers (current sheet is always sheets[0] in Step 0)
  nodes: GraphNode[];
  edges: GraphEdge[];

  // ID of the most recently created node (triggers auto-focus in CustomNode)
  newlyCreatedNodeId: string | null;

  // File operations
  loadFile: (file: ConversensusFile, path: string) => void;
  newFile: () => void;
  markSaved: (path: string) => void;
  markDirty: () => void;

  // Graph operations (all mutate the store → Zustand is single source of truth)
  addNode: (position: { x: number; y: number }) => GraphNode;
  updateNodeContent: (id: string, content: string) => void;
  updateNodePosition: (id: string, position: { x: number; y: number }) => void;
  addEdge: (source: string, target: string) => GraphEdge;
  updateEdgeLabel: (id: string, label: string) => void;
  deleteNodes: (ids: string[]) => void;
  deleteEdges: (ids: string[]) => void;

  clearNewlyCreatedNode: () => void;

  // Sync from React Flow controlled updates
  applyNodeChanges: (nodes: GraphNode[]) => void;
  applyEdgeChanges: (edges: GraphEdge[]) => void;
}

function getSheet(file: ConversensusFile): Sheet {
  return file.sheets[0];
}

export const useGraphStore = create<GraphState>((set) => ({
  file: null,
  fileName: null,
  filePath: null,
  isDirty: false,
  nodes: [],
  edges: [],
  newlyCreatedNodeId: null,

  loadFile: (file, path) => {
    const sheet = getSheet(file);
    const name = path.split(/[\\/]/).pop() ?? path;
    set({
      file,
      fileName: name,
      filePath: path,
      isDirty: false,
      nodes: sheet.nodes,
      edges: sheet.edges,
      newlyCreatedNodeId: null,
    });
  },

  newFile: () => {
    const file = createNewFile();
    set({
      file,
      fileName: "Untitled",
      filePath: null,
      isDirty: false,
      nodes: [],
      edges: [],
      newlyCreatedNodeId: null,
    });
  },

  markSaved: (path) => {
    const name = path.split(/[\\/]/).pop() ?? path;
    set({ filePath: path, fileName: name, isDirty: false });
  },

  markDirty: () => set({ isDirty: true }),

  addNode: (position) => {
    const node: GraphNode = {
      id: nanoid(),
      content: "",
      properties: {},
      style: {},
      position,
    };
    set((state) => ({
      nodes: [...state.nodes, node],
      isDirty: true,
      newlyCreatedNodeId: node.id,
    }));
    return node;
  },

  clearNewlyCreatedNode: () => set({ newlyCreatedNodeId: null }),

  updateNodeContent: (id, content) => {
    set((state) => ({
      nodes: state.nodes.map((n) => (n.id === id ? { ...n, content } : n)),
      isDirty: true,
    }));
  },

  updateNodePosition: (id, position) => {
    set((state) => ({
      nodes: state.nodes.map((n) => (n.id === id ? { ...n, position } : n)),
      isDirty: true,
    }));
  },

  addEdge: (source, target) => {
    const edge: GraphEdge = {
      id: nanoid(),
      source,
      target,
      properties: { label: "" },
      style: {},
    };
    set((state) => ({
      edges: [...state.edges, edge],
      isDirty: true,
    }));
    return edge;
  },

  updateEdgeLabel: (id, label) => {
    set((state) => ({
      edges: state.edges.map((e) =>
        e.id === id ? { ...e, properties: { ...e.properties, label } } : e
      ),
      isDirty: true,
    }));
  },

  deleteNodes: (ids) => {
    const idSet = new Set(ids);
    set((state) => ({
      nodes: state.nodes.filter((n) => !idSet.has(n.id)),
      // Also remove edges connected to deleted nodes
      edges: state.edges.filter(
        (e) => !idSet.has(e.source) && !idSet.has(e.target)
      ),
      isDirty: true,
    }));
  },

  deleteEdges: (ids) => {
    const idSet = new Set(ids);
    set((state) => ({
      edges: state.edges.filter((e) => !idSet.has(e.id)),
      isDirty: true,
    }));
  },

  applyNodeChanges: (nodes) => {
    set({ nodes });
  },

  applyEdgeChanges: (edges) => {
    set({ edges });
  },

  // Produce a serializable ConversensusFile from current state
  // (used internally by useTauriFiles before saving)
  ...({} as object),
}));

/** Build a ConversensusFile from the current store state for saving */
export function buildFileForSave(state: GraphState): ConversensusFile | null {
  if (!state.file) return null;
  return {
    ...state.file,
    sheets: [
      {
        ...state.file.sheets[0],
        nodes: state.nodes,
        edges: state.edges,
      },
    ],
  };
}
