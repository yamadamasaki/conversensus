import type { GraphNode, NodeId } from '@conversensus/shared';
import {
  Handle,
  type NodeProps,
  NodeResizer,
  Position,
  useReactFlow,
} from '@xyflow/react';
import { useCallback, useRef } from 'react';
import { useEventDispatch } from './EventDispatchContext';
import { makeEventBase } from './events/GraphEvent';
import { DEFAULT_NODE_STYLE } from './graphTransform';
import { useInlineEdit } from './hooks/useInlineEdit';

export function GroupNode({
  id,
  data,
  selected,
  positionAbsoluteX,
  positionAbsoluteY,
}: NodeProps) {
  const { screenToFlowPosition, getNode } = useReactFlow();
  const { dispatch } = useEventDispatch();

  // onResizeStart で現在のサイズを保存
  const preSizeRef = useRef({ width: 0, height: 0 });

  const onResizeStart = useCallback(() => {
    const node = getNode(id);
    if (node) {
      preSizeRef.current = {
        width: Number(node.measured?.width ?? node.style?.width ?? 0),
        height: Number(node.measured?.height ?? node.style?.height ?? 0),
      };
    }
  }, [getNode, id]);

  const onResizeEnd = useCallback(
    (_event: unknown, params: { width: number; height: number }) => {
      const from = preSizeRef.current;
      if (from.width !== params.width || from.height !== params.height) {
        dispatch({
          ...makeEventBase('layout'),
          type: 'NODE_RESIZED',
          nodeId: id as NodeId,
          from,
          to: {
            width: params.width,
            height: params.height,
          },
        });
      }
    },
    [dispatch, id],
  );

  // ドラッグのたびに変わる絶対座標を ref で保持し, コールバックの再生成を防ぐ
  const positionAbsoluteRef = useRef({
    x: positionAbsoluteX,
    y: positionAbsoluteY,
  });
  positionAbsoluteRef.current = { x: positionAbsoluteX, y: positionAbsoluteY };

  const onBodyDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const flowPos = screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });
      const nodeId = crypto.randomUUID() as NodeId;
      const pos = {
        x: flowPos.x - positionAbsoluteRef.current.x,
        y: flowPos.y - positionAbsoluteRef.current.y,
      };
      const graphNode: GraphNode = {
        id: nodeId,
        content: '',
        parentId: id as NodeId,
        style: { x: pos.x, y: pos.y, ...DEFAULT_NODE_STYLE },
      };
      dispatch({
        ...makeEventBase('structure'),
        type: 'NODE_ADDED',
        nodeId,
        data: graphNode,
      });
    },
    [id, screenToFlowPosition, dispatch],
  );
  const label = String(data.label ?? '');

  const {
    editing,
    inputValue,
    setInputValue,
    composing,
    setComposing,
    startEdit,
    confirm,
    cancel,
  } = useInlineEdit(label, (value) => {
    if (value !== label) {
      dispatch({
        ...makeEventBase('content'),
        type: 'NODE_RELABELED',
        nodeId: id as NodeId,
        from: label,
        to: value,
      });
    }
  });

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={120}
        minHeight={80}
        onResizeStart={onResizeStart}
        onResizeEnd={onResizeEnd}
      />
      <Handle
        type="source"
        position={Position.Top}
        id="source-top"
        style={{ zIndex: 10, pointerEvents: 'all' }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="source-bottom"
        style={{ zIndex: 10, pointerEvents: 'all' }}
      />
      <Handle
        type="source"
        position={Position.Left}
        id="source-left"
        style={{ zIndex: 10, pointerEvents: 'all' }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="source-right"
        style={{ zIndex: 10, pointerEvents: 'all' }}
      />
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 8,
          border: '2px solid #7c9ef8',
          background: 'rgba(79, 110, 247, 0.06)',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* biome-ignore lint/a11y/noStaticElementInteractions: タイトルバーはダブルクリックで編集を開始する */}
        <div
          style={{
            padding: '4px 10px',
            borderBottom: '1px solid #c0cffc',
            background: 'rgba(79, 110, 247, 0.12)',
            borderRadius: '6px 6px 0 0',
            cursor: 'default',
            fontSize: 12,
            fontWeight: 600,
            color: '#3a5bd9',
            minHeight: 26,
            display: 'flex',
            alignItems: 'center',
          }}
          onDoubleClick={
            !editing
              ? (e) => {
                  e.stopPropagation();
                  startEdit();
                }
              : undefined
          }
        >
          {editing ? (
            <input
              // biome-ignore lint/a11y/noAutofocus: グループ名編集開始時に即座に入力できるよう autoFocus が必要
              autoFocus
              className="nodrag nopan"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onBlur={confirm}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => setComposing(false)}
              onKeyDown={(e) => {
                if (composing) return;
                if (e.key === 'Enter') confirm();
                if (e.key === 'Escape') cancel();
              }}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: '0 2px',
                border: '1px solid #4f6ef7',
                borderRadius: 3,
                outline: 'none',
                width: '100%',
                background: 'transparent',
                color: '#3a5bd9',
              }}
            />
          ) : (
            <span>{label || 'グループ'}</span>
          )}
        </div>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: 本体エリアはダブルクリックで子ノードを追加する */}
        <div style={{ flex: 1 }} onDoubleClick={onBodyDoubleClick} />
      </div>
    </>
  );
}
