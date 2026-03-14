import "./Toolbar.css";

interface ToolbarProps {
  onAddNode: () => void;
  onDeleteSelected: () => void;
  hasSelection: boolean;
}

export function Toolbar({ onAddNode, onDeleteSelected, hasSelection }: ToolbarProps) {
  return (
    <div className="toolbar">
      <button
        className="toolbar-btn"
        onClick={onAddNode}
        title="Add node (double-click canvas)"
      >
        + Node
      </button>
      <button
        className="toolbar-btn danger"
        onClick={onDeleteSelected}
        disabled={!hasSelection}
        title="Delete selected (Del)"
      >
        Delete
      </button>
      <span className="toolbar-hint">
        Double-click canvas to add node · Drag handle to connect
      </span>
    </div>
  );
}
