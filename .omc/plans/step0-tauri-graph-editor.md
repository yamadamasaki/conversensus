# conversensus Step 0: Tauri Graph Editor Implementation Plan

**Date:** 2026-03-14
**Status:** REVISED v2

---

## RALPLAN-DR Summary

### Principles (5)

1. **Minimal Viable Step 0** -- Implement only what the roadmap specifies: no auth, no groups, no templates, one sheet per file, edge label only, graph view only.
2. **Domain Model Fidelity** -- The data model must faithfully represent the ontology (File, Sheet, Node, Edge) even in its reduced Step 0 form, so future steps can extend without rewriting.
3. **Separation of Concerns** -- Keep Rust backend (file I/O, data validation) cleanly separated from web frontend (rendering, interaction), enabling the platform step 1 transition to server/client.
4. **Graph-First UX** -- The application is a graph editor for expressing thought through labeled directed graphs, not a drawing tool. Interaction design should prioritize semantic graph operations (add node, connect, label) over visual styling.
5. **File Format Stability** -- The JSON file format must be versioned from day one, and the version field must be actively checked on load, so future steps can migrate files forward.

### Decision Drivers (Top 3)

1. **Graph library choice** -- The graph rendering/editing library is the most consequential technical decision; it determines interaction quality, extensibility, and the ceiling for future features.
2. **Tauri v2 maturity** -- Tauri v2 is stable and supports the file system APIs needed. Using v2 (not v1) aligns with long-term support.
3. **Frontend framework alignment** -- Must pair well with the chosen graph library and be productive for a small team.

### Viable Options

#### Option A: React + React Flow (Recommended)

| Aspect | Assessment |
|--------|-----------|
| Graph library | React Flow (xyflow) -- purpose-built for node-based graph editors, handles pan/zoom/drag, edge routing, custom nodes |
| Frontend | React 19 + TypeScript |
| Bundler | Vite (Tauri v2 default) |
| Pros | Large ecosystem, React Flow is mature and well-documented, custom node/edge rendering is straightforward, strong TypeScript support |
| Cons | React Flow is optimized for flowchart-style graphs (top-down/left-right) which may need layout tuning for free-form graphs; React bundle size is non-trivial but irrelevant in Tauri |

#### Option B: Svelte + Svelvet

| Aspect | Assessment |
|--------|-----------|
| Graph library | Svelvet -- Svelte-native graph component library |
| Frontend | Svelte 5 + TypeScript |
| Bundler | Vite |
| Pros | Smaller bundle, reactive model fits graph state well, Svelvet API is clean |
| Cons | Svelvet is less mature than React Flow (smaller community, fewer edge-routing options, less documentation), Svelte ecosystem is smaller for Tauri integration examples |

**Recommendation:** Option A (React + React Flow). React Flow's maturity, documentation, and custom node/edge support make it the stronger choice for a graph editor where the interaction model is central. The transition to platform step 1 (web server/client) is also simpler with React's broader ecosystem.

**Why Option B was not chosen:** Svelvet's relative immaturity poses risk for a project where graph editing quality is the core value proposition. The bundle size advantage is irrelevant in a Tauri desktop app.

---

## Architecture Overview

```
conversensus/
  src-tauri/          # Rust backend
    src/
      main.rs         # Tauri entry point
      commands.rs     # Tauri command handlers (file I/O)
      models.rs       # Data model structs (File, Sheet, Node, Edge)
      storage.rs      # JSON file read/write logic
    Cargo.toml
    tauri.conf.json
  src/                # React frontend
    App.tsx           # Main application shell
    components/
      GraphCanvas.tsx     # React Flow canvas wrapper
      CustomNode.tsx      # Custom node component (text content)
      CustomEdge.tsx      # Custom edge component (labeled)
      Toolbar.tsx         # Node/edge creation controls
      FileManager.tsx     # File open/save/new dialogs
    hooks/
      useGraphStore.ts    # Zustand store for graph state
      useTauriFiles.ts    # Hook wrapping Tauri file commands (sole location for invoke calls)
    types/
      graph.ts            # TypeScript types matching Rust models
    main.tsx
  index.html
  package.json
  vite.config.ts
```

### Data Model (Step 0 subset)

```typescript
// File format version for forward compatibility
interface ConversensusFile {
  version: "0.1.0"
  file: {
    name: string
    description: string
  }
  sheets: Sheet[]       // Array form for forward compatibility; Step 0 enforces sheets.length === 1
}

interface Sheet {
  name: string
  description: string
  nodes: Node[]
  edges: Edge[]
}

interface Node {
  id: string            // Generated via nanoid (compact, URL-safe, collision-resistant)
  content: string       // Text content (Step 0: text only, no images)
  properties: Record<string, string>  // Schema placeholder; unused in Step 0 UI, present for ontology alignment
  style: NodeStyle
  position: { x: number; y: number }  // Canvas position
}

interface Edge {
  id: string            // Generated via nanoid
  source: string        // Node ID
  target: string        // Node ID
  properties: Record<string, string>  // General-purpose; Step 0 uses properties["label"] for edge labels
  style: EdgeStyle
}

// Step 0 style types: minimal placeholders, extensible in future steps
type NodeStyle = {
  color?: string
  width?: number
  height?: number
}

type EdgeStyle = {
  color?: string
  strokeWidth?: number
}
```

**ID generation strategy:** Use `nanoid` (21-character URL-safe IDs by default). Chosen over UUID v4 for compactness in JSON files and readability during debugging.

### Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Tauri | v2 |
| Backend | Rust | stable |
| Frontend | React | 19 |
| Graph rendering | React Flow (@xyflow/react) | latest |
| State management | Zustand | 5.x |
| ID generation | nanoid | 5.x |
| Language | TypeScript | 5.x |
| Bundler | Vite | 6.x |
| Styling | CSS Modules or Tailwind CSS | -- |
| Frontend testing | Vitest | latest |
| Backend testing | cargo test | -- |

---

## Task Flow (5 Steps)

### Step 1: Project Scaffolding and Data Model

**Objective:** Set up the Tauri v2 + React project and define the data model in both Rust and TypeScript.

**Tasks:**
- Initialize Tauri v2 project with React + TypeScript + Vite template (`npm create tauri-app@latest`)
- Define Rust structs in `models.rs`: `ConversensusFile`, `Sheet`, `Node`, `Edge` with serde serialization; `sheets` field is `Vec<Sheet>`
- Define matching TypeScript types in `src/types/graph.ts` including `NodeStyle`, `EdgeStyle`, and the `sheets: Sheet[]` array structure
- Install `nanoid` and create an ID utility module
- Create a sample `.conversensus.json` fixture file for testing (with `sheets: [...]` array containing one sheet)
- Configure Vitest for frontend tests; verify `cargo test` runs for backend
- Verify the app launches as an empty Tauri window with React rendering

**Acceptance Criteria:**
- [ ] `cargo tauri dev` launches a desktop window showing a React hello-world
- [ ] Rust model structs compile and can serialize/deserialize the sample fixture JSON (with `sheets` as an array)
- [ ] TypeScript types exist and are importable, including `NodeStyle` and `EdgeStyle`
- [ ] Sample fixture file round-trips through Rust serde without data loss
- [ ] `npx vitest run` executes successfully (even if no tests yet); `cargo test` compiles and runs

---

### Step 2: File I/O via Tauri Commands

**Objective:** Implement file open, save, and new-file operations through Tauri's command system and native file dialogs, with version validation.

**Tasks:**
- Implement Tauri commands in `commands.rs`: `open_file`, `save_file`, `new_file`
- Use Tauri's dialog plugin for native file open/save dialogs (`.conversensus.json` extension filter)
- Implement `storage.rs` for JSON read/write with error handling
- Implement version checking on file load: parse `version` field, reject unrecognized versions with a clear user-facing error message (not a crash)
- Implement `sheets.length` validation on file load: reject files with `sheets.length !== 1` in Step 0, with a clear error ("this version supports single-sheet files only")
- On new file creation, initialize with `sheets: [{ name: "Sheet 1", description: "", nodes: [], edges: [] }]`
- Create `useTauriFiles.ts` hook wrapping the Tauri `invoke` calls -- this is the sole module permitted to call `invoke`
- Build `FileManager.tsx` component with New / Open / Save buttons
- Wire file operations to the frontend

**Acceptance Criteria:**
- [ ] User can create a new file (gets a blank graph with `sheets` array containing one default sheet)
- [ ] User can save a file to disk via native Save dialog; resulting JSON is valid, has `sheets` as an array, and matches the schema
- [ ] User can open an existing `.conversensus.json` file via native Open dialog; data loads correctly
- [ ] Attempting to open a malformed file shows an error message (does not crash)
- [ ] Opening a file with an unrecognized `version` value surfaces a clear error to the user
- [ ] Opening a file with `sheets.length !== 1` surfaces a clear error ("this version supports single-sheet files only")
- [ ] File extension is `.conversensus.json`
- [ ] All Tauri `invoke` calls are in `useTauriFiles.ts` and nowhere else

---

### Step 3: Graph Canvas with Node and Edge Display

**Objective:** Render the graph data model as an interactive canvas using React Flow.

**Tasks:**
- Install `@xyflow/react` and configure within the app
- Implement `GraphCanvas.tsx` wrapping React Flow with pan, zoom, and selection
- Implement `CustomNode.tsx` displaying node text content in a styled box
- Implement `CustomEdge.tsx` displaying the edge label (read from `edge.properties["label"]`) on the connecting line
- Create `useGraphStore.ts` (Zustand) to hold the current graph state and sync with React Flow's internal state
- Load graph data from file into the store; render nodes and edges on canvas

**Acceptance Criteria:**
- [ ] Opening a fixture file displays nodes as labeled boxes at their saved positions
- [ ] Edges render as directed arrows between nodes with labels visible on the edge (label sourced from `properties["label"]`)
- [ ] Canvas supports pan (drag background) and zoom (scroll wheel)
- [ ] Nodes can be selected by clicking; edges can be selected by clicking
- [ ] Multiple selection works (shift-click or drag-select)

---

### Step 4: Graph Editing Operations

**Objective:** Enable the user to create, modify, and delete nodes and edges via direct manipulation.

**Tasks:**
- Implement node creation: double-click on canvas background creates a new node with empty text content and immediately focuses an inline text editor within the node (no browser prompt/dialog)
- Implement edge creation: drag from a node handle to another node to create an edge; edge is created with an empty label that can be edited inline
- Implement node editing: double-click a node to activate inline text editing within the node component
- Implement edge label editing: double-click an edge label to activate inline editing on the edge (no browser prompt/dialog)
- Implement deletion: select node(s)/edge(s) and press Delete/Backspace to remove them; deleting a node also removes its connected edges
- Implement node dragging: drag nodes to reposition them; position persists in the data model
- Build `Toolbar.tsx` with mode indicators and action buttons (Add Node, Delete Selected)
- All edits update the Zustand store; dirty state tracked for save prompting
- Node and edge IDs generated via `nanoid`

**Acceptance Criteria:**
- [ ] User can create a node by double-clicking empty canvas space; an inline text editor appears immediately in the new node (no browser dialogs)
- [ ] User can create a directed edge by dragging from one node's handle to another node
- [ ] User can assign/edit a label on an edge via inline editing (double-click the edge label text)
- [ ] User can edit node text by double-clicking the node (inline editing, not a prompt)
- [ ] User can delete selected nodes and edges with Delete key; connected edges are cleaned up
- [ ] User can drag nodes to new positions; positions persist after save/reload
- [ ] Unsaved changes are indicated in the window title (e.g., asterisk or "modified" marker)

---

### Step 5: File Management Polish and Integration Testing

**Objective:** Complete the end-to-end workflow with save prompting, keyboard shortcuts, and integration tests.

**Note on undo/redo:** Undo/redo is deferred to a post-Step-0 task. Implementing reliable undo/redo with React Flow + Zustand requires significant design decisions (history stack depth, event coalescing for drag operations, undoable action granularity) that exceed minimal Step 0 scope. It will be planned as a dedicated task using `zundo` (Zustand temporal middleware) when prioritized.

**Tasks:**
- Implement "unsaved changes" guard: prompt user to save before closing window or opening a new file
- Add keyboard shortcuts: Ctrl/Cmd+S (save), Ctrl/Cmd+O (open), Ctrl/Cmd+N (new)
- Write Vitest integration tests for frontend: graph store operations, file load/save hooks
- Write `cargo test` tests for backend: model serialization round-trip, version validation, sheets-length validation, malformed file rejection
- Test edge cases: empty graph save/load, very long node text, many nodes performance spot-check
- Verify the complete workflow end-to-end: launch -> new file -> add nodes -> add edges -> save -> close -> reopen -> verify

**Acceptance Criteria:**
- [ ] Closing the app or opening a new file with unsaved changes prompts the user to save
- [ ] Ctrl/Cmd+S saves, Ctrl/Cmd+O opens, Ctrl/Cmd+N creates new file
- [ ] A graph with 50+ nodes and edges loads and renders without noticeable lag
- [ ] Full round-trip test passes: create -> edit -> save -> close -> reopen -> all data intact including positions and labels
- [ ] Vitest tests pass for graph store operations and file hooks
- [ ] `cargo test` passes for model serialization, version checking, and sheets-length validation

---

## Guardrails

### Must Have
- File format includes a `version` field from the start, actively validated on load
- `sheets` is always an array; Step 0 enforces `sheets.length === 1` in the Rust backend
- All graph operations are reflected in the Zustand store (single source of truth)
- Rust backend validates JSON structure on load (rejects invalid files gracefully)
- TypeScript strict mode enabled
- No `invoke` calls outside `useTauriFiles.ts`
- Node and edge IDs generated via `nanoid`

### Must NOT Have
- Authentication or user management (deferred to platform step 1)
- Groups (deferred to function step 1)
- Templates (deferred to function step 1)
- Multiple sheets per file in the UI (deferred to function step 1; file format supports array for forward compatibility)
- Multiple view types (only graph view in Step 0)
- Image content in nodes (Step 0 is text only)
- Cloud storage or network features
- Undo/redo (deferred to post-Step-0; requires dedicated design for history stack, event coalescing, and `zundo` integration)

---

## Success Criteria (Overall)

1. A user can launch the app, create a new file, build a labeled directed graph by adding nodes with text and connecting them with labeled edges, save it, and reopen it with all data preserved.
2. The graph is navigable with pan/zoom and editable with intuitive direct-manipulation interactions (all editing is inline, no browser prompts).
3. The codebase is cleanly separated into Rust backend (file I/O, data model) and React frontend (rendering, interaction), ready for platform step 1 evolution.
4. The JSON file format is versioned, version-checked on load, uses `sheets` array for forward compatibility, and is documented.

---

## ADR: Desktop Runtime and Graph Library

**Decision:** Use Tauri v2 with React 19 and React Flow (@xyflow/react) for the Step 0 implementation.

**Drivers:**
1. Step 0 requires local execution with file-based storage -- Tauri provides native filesystem access and native dialogs.
2. The application is fundamentally a graph editor -- React Flow is the most mature open-source node/edge graph editor library.
3. The roadmap anticipates a transition to HTTP server/client -- React frontend code can be reused with minimal changes when the Tauri shell is replaced by a browser.

**Alternatives Considered:**
- **Svelte + Svelvet on Tauri:** Svelvet is less mature; risk of hitting limitations in edge routing and custom rendering. Svelte's smaller ecosystem reduces available Tauri integration references.
- **Electron + React:** Viable but Electron has significantly larger binary size and memory footprint. Tauri's Rust backend also provides a natural place for data validation logic that will scale to platform step 1.
- **Browser-only with File System Access API:** Eliminates the native app packaging but limits browser support (Chrome/Edge only) and cannot intercept window close events reliably for save prompting.

**Why Chosen:** Tauri v2 + React Flow provides the best balance of graph editing maturity, native desktop integration, and code reusability for the planned platform evolution. The Rust backend adds type safety for the data model that complements TypeScript on the frontend.

**Consequences:**
- Developers need Rust toolchain installed alongside Node.js
- Tauri v2 plugins (dialog, fs) must be configured in `tauri.conf.json` capabilities
- React Flow's node/edge model maps well to the conversensus ontology but custom styling will be needed to move beyond the default flowchart aesthetic

**Follow-ups:**
- Evaluate graph auto-layout libraries (e.g., dagre, elkjs) for function step 1
- Assess whether React Flow's performance ceiling (thousands of nodes) is sufficient for future use cases
- Plan the Tauri-to-web transition architecture when platform step 1 begins
- Design and implement undo/redo as a dedicated post-Step-0 task using `zundo` (Zustand temporal middleware)
