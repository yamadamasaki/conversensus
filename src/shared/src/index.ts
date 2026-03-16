export type GraphNode = {
  id: string;
  content: string;
  position: { x: number; y: number };
  style?: Record<string, unknown>;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  style?: Record<string, unknown>;
};

export type Sheet = {
  id: string;
  name: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type GraphFile = {
  id: string;
  name: string;
  description?: string;
  sheet: Sheet;
};

export type GraphFileListItem = {
  id: string;
  name: string;
  description?: string;
};
