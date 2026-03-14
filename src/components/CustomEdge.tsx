import { useState, useCallback } from "react";
import {
  getBezierPath,
  EdgeLabelRenderer,
  BaseEdge,
  type EdgeProps,
} from "@xyflow/react";
import { useGraphStore } from "../hooks/useGraphStore";

export interface CustomEdgeData {
  label?: string;
  [key: string]: unknown;
}

export function CustomEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const edgeData = data as CustomEdgeData | undefined;
  const label = edgeData?.label ?? "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const updateLabel = useGraphStore((s) => s.updateEdgeLabel);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const commitEdit = useCallback(() => {
    updateLabel(id, draft);
    setEditing(false);
  }, [id, draft, updateLabel]);

  const handleDoubleClick = useCallback(() => {
    setDraft(label);
    setEditing(true);
  }, [label]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        setDraft(label);
        setEditing(false);
      } else if (e.key === "Enter") {
        commitEdit();
      }
    },
    [label, commitEdit]
  );

  return (
    <>
      <BaseEdge
        path={edgePath}
        style={{
          stroke: selected ? "#61dafb" : "#4a9eda",
          strokeWidth: selected ? 2 : 1.5,
        }}
        markerEnd="url(#arrowhead)"
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: "all",
          }}
          className="nodrag nopan"
          onDoubleClick={handleDoubleClick}
        >
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={handleKeyDown}
              style={{
                background: "#0f2d4a",
                color: "#e0e0e0",
                border: "1px solid #61dafb",
                borderRadius: "3px",
                padding: "2px 6px",
                fontSize: "12px",
                fontFamily: "inherit",
                outline: "none",
                minWidth: "60px",
              }}
            />
          ) : label ? (
            <div
              style={{
                background: "rgba(22, 33, 62, 0.85)",
                color: "#c8e6ff",
                padding: "2px 6px",
                borderRadius: "3px",
                fontSize: "12px",
                cursor: "default",
                userSelect: "none",
                border: selected ? "1px solid #61dafb" : "1px solid transparent",
              }}
            >
              {label}
            </div>
          ) : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
