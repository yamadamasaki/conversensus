import type { EdgeId, EdgePathType } from '@conversensus/shared';
import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useReactFlow,
} from '@xyflow/react';
import { useCallback, useRef } from 'react';
import { useEventDispatch } from './EventDispatchContext';
import { makeEventBase } from './events/GraphEvent';
import { useInlineEdit } from './hooks/useInlineEdit';

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

const DRAG_THRESHOLD_PX = 3;

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
  const { dispatch, setDragging } = useEventDispatch();

  const pathType = (data?.pathType as EdgePathType | undefined) ?? 'bezier';
  const [edgePath, labelX, labelY] = getEdgePath(pathType, {
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const offsetX = (data?.labelOffsetX as number | undefined) ?? 0;
  const offsetY = (data?.labelOffsetY as number | undefined) ?? 0;

  const {
    editing,
    inputValue,
    setInputValue,
    composing,
    setComposing,
    startEdit,
    confirm,
    cancel,
  } = useInlineEdit(String(label ?? ''), (value) => {
    const from = String(label ?? '');
    if (value !== from) {
      dispatch({
        ...makeEventBase('content'),
        type: 'EDGE_RELABELED',
        edgeId: id as EdgeId,
        from,
        to: value,
      });
    }
  });

  // ドラッグ追跡
  const dragStartRef = useRef({
    x: 0,
    y: 0,
    offsetX: 0,
    offsetY: 0,
  });
  const isDraggingRef = useRef(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (editing) return;
      e.stopPropagation();
      isDraggingRef.current = false;
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        offsetX,
        offsetY,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
    },
    [editing, offsetX, offsetY, setDragging],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      if (
        !isDraggingRef.current &&
        (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX)
      ) {
        isDraggingRef.current = true;
      }
      if (!isDraggingRef.current) return;
      setEdges((es) =>
        es.map((ed) =>
          ed.id === id
            ? {
                ...ed,
                data: {
                  ...ed.data,
                  labelOffsetX: dragStartRef.current.offsetX + dx,
                  labelOffsetY: dragStartRef.current.offsetY + dy,
                },
              }
            : ed,
        ),
      );
    },
    [id, setEdges],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (isDraggingRef.current) {
        // ドラッグ完了 → EDGE_LABEL_MOVED を dispatch
        const fromOffset = {
          offsetX: dragStartRef.current.offsetX,
          offsetY: dragStartRef.current.offsetY,
        };
        const dx = e.clientX - dragStartRef.current.x;
        const dy = e.clientY - dragStartRef.current.y;
        const toOffset = {
          offsetX: dragStartRef.current.offsetX + dx,
          offsetY: dragStartRef.current.offsetY + dy,
        };
        dispatch({
          ...makeEventBase('presentation'),
          type: 'EDGE_LABEL_MOVED',
          edgeId: id as EdgeId,
          from: fromOffset,
          to: toOffset,
        });
      }
      e.currentTarget.releasePointerCapture(e.pointerId);
      setDragging(false);
    },
    [dispatch, id, setDragging],
  );

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
            transform: `translate(-50%, -50%) translate(${labelX + offsetX}px,${labelY + offsetY}px)`,
            pointerEvents: 'all',
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: editing ? 'default' : 'grab',
          }}
          className="nodrag nopan"
          onDoubleClick={
            !editing
              ? (e) => {
                  if (!isDraggingRef.current) {
                    e.stopPropagation();
                    startEdit();
                  }
                }
              : undefined
          }
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
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
                  cursor: 'grab',
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
