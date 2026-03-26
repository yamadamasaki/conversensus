import type { EdgePathType } from '@conversensus/shared';
import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useReactFlow,
} from '@xyflow/react';
import { useCallback, useState } from 'react';

function getEdgePath(
  pathType: EdgePathType,
  params: {
    sourceX: number;
    sourceY: number;
    sourcePosition: EdgeProps['sourcePosition'];
    targetX: number;
    targetY: number;
    targetPosition: EdgeProps['targetPosition'];
  },
): ReturnType<typeof getBezierPath> {
  switch (pathType) {
    case 'straight':
      return getStraightPath(params);
    case 'step':
      return getSmoothStepPath({ ...params, borderRadius: 0 });
    case 'smoothstep':
      return getSmoothStepPath(params);
    default:
      return getBezierPath(params);
  }
}

export function EditableLabelEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  markerEnd,
  style,
  data,
}: EdgeProps) {
  const { setEdges } = useReactFlow();
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [composing, setComposing] = useState(false);

  const pathType = (data?.pathType as EdgePathType | undefined) ?? 'bezier';
  const [edgePath, labelX, labelY] = getEdgePath(pathType, {
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const startEdit = useCallback(() => {
    setInputValue(String(label ?? ''));
    setEditing(true);
  }, [label]);

  const confirm = useCallback(() => {
    setEdges((es) =>
      es.map((e) => (e.id === id ? { ...e, label: inputValue } : e)),
    );
    setEditing(false);
  }, [id, inputValue, setEdges]);

  const cancel = useCallback(() => {
    setInputValue(String(label ?? ''));
    setEditing(false);
  }, [label]);

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      {/* ダブルクリック用の透明な幅広パス: SVG path は role/keyboard 対応が不要なインタラクション */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: SVG path element for visual double-click interaction */}
      <path
        d={edgePath}
        strokeWidth={20}
        stroke="transparent"
        fill="none"
        style={{ cursor: 'pointer' }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          startEdit();
        }}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'default',
          }}
          className="nodrag nopan"
          onDoubleClick={!editing ? startEdit : undefined}
        >
          {editing ? (
            <input
              // biome-ignore lint/a11y/noAutofocus: ラベル編集開始時に即座に入力できるよう autoFocus が必要
              autoFocus
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onBlur={confirm}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => setComposing(false)}
              onKeyDown={(e) => {
                if (composing) return; // IME 変換中は無視
                if (e.key === 'Enter') confirm();
                if (e.key === 'Escape') cancel();
              }}
              style={{
                fontSize: 12,
                padding: '2px 4px',
                borderRadius: 3,
                border: '1px solid #4f6ef7',
                outline: 'none',
                minWidth: 60,
              }}
            />
          ) : (
            label != null &&
            label !== '' && (
              <span
                style={{
                  fontSize: 12,
                  background: 'white',
                  padding: '2px 6px',
                  borderRadius: 3,
                  border: '1px solid #ddd',
                  cursor: 'pointer',
                }}
              >
                {label}
              </span>
            )
          )}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
