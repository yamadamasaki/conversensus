// conversensus data model — Step 0 subset
// Mirrors Rust structs in src-tauri/src/models.rs

export const SUPPORTED_VERSION = "0.1.0" as const;
export type FileVersion = typeof SUPPORTED_VERSION;

export interface NodeStyle {
  color?: string;
  width?: number;
  height?: number;
}

export interface EdgeStyle {
  color?: string;
  strokeWidth?: number;
}

export interface GraphNode {
  id: string; // nanoid
  content: string; // Text content (Step 0: text only)
  /** Schema placeholder — present for ontology alignment; unused in Step 0 UI */
  properties: Record<string, string>;
  style: NodeStyle;
  position: { x: number; y: number };
}

export interface GraphEdge {
  id: string; // nanoid
  source: string; // GraphNode.id
  target: string; // GraphNode.id
  /** General-purpose properties. Step 0 uses properties["label"] for edge labels */
  properties: Record<string, string>;
  style: EdgeStyle;
}

export interface Sheet {
  name: string;
  description: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Top-level file format.
 * `sheets` is always an array for forward compatibility.
 * Step 0 enforces sheets.length === 1 in the Rust backend.
 */
export interface ConversensusFile {
  version: FileVersion;
  file: {
    name: string;
    description: string;
  };
  sheets: Sheet[];
}

/** Create a blank new file with one empty sheet */
export function createNewFile(name = "Untitled"): ConversensusFile {
  return {
    version: SUPPORTED_VERSION,
    file: { name, description: "" },
    sheets: [
      {
        name: "Sheet 1",
        description: "",
        nodes: [],
        edges: [],
      },
    ],
  };
}
