import { useState, useRef, useEffect, useCallback } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useGraphStore } from "../hooks/useGraphStore";
import "./CustomNode.css";

export interface CustomNodeData {
  content: string;
  isNew?: boolean; // true = focus inline editor immediately on mount
  [key: string]: unknown;
}

export function CustomNode({ id, data, selected }: NodeProps) {
  const nodeData = data as CustomNodeData;
  const [editing, setEditing] = useState(nodeData.isNew === true);
  const [draft, setDraft] = useState(nodeData.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const updateContent = useGraphStore((s) => s.updateNodeContent);

  // Focus on mount if this is a newly created node
  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [editing]);

  const commitEdit = useCallback(() => {
    updateContent(id, draft);
    setEditing(false);
  }, [id, draft, updateContent]);

  const handleDoubleClick = useCallback(() => {
    setDraft(nodeData.content);
    setEditing(true);
  }, [nodeData.content]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape") {
        setDraft(nodeData.content);
        setEditing(false);
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        commitEdit();
      }
    },
    [nodeData.content, commitEdit]
  );

  return (
    <div
      className={`custom-node${selected ? " selected" : ""}`}
      onDoubleClick={handleDoubleClick}
    >
      <Handle type="target" position={Position.Top} />
      <Handle type="target" position={Position.Left} />

      {editing ? (
        <textarea
          ref={textareaRef}
          className="node-editor"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
          rows={3}
        />
      ) : (
        <div className="node-content">
          {nodeData.content || <span className="placeholder">double-click to edit</span>}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
