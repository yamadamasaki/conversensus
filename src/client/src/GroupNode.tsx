import {
  Handle,
  type NodeProps,
  NodeResizer,
  Position,
  useReactFlow,
} from '@xyflow/react';
import { useCallback, useRef } from 'react';
import { DEFAULT_NODE_STYLE, recalculateParentBounds } from './graphTransform';
import { useInlineEdit } from './hooks/useInlineEdit';

export function GroupNode({
  id,
  data,
  selected,
  positionAbsoluteX,
  positionAbsoluteY,
}: NodeProps) {
  const { setNodes, screenToFlowPosition } = useReactFlow();
  const onResizeEnd = useCallback(
    () => setNodes((ns) => recalculateParentBounds(ns)),
    [setNodes],
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
      const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      setNodes((ns) => [
        ...ns,
        {
          id: crypto.randomUUID(),
          parentId: id,
          position: {
            x: flowPos.x - positionAbsoluteRef.current.x,
            y: flowPos.y - positionAbsoluteRef.current.y,
          },
          data: { label: '' },
          type: 'editableNode',
          style: DEFAULT_NODE_STYLE,
        },
      ]);
    },
    [id, screenToFlowPosition, setNodes],
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
  } = useInlineEdit(label, (value) =>
    setNodes((ns) =>
      ns.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, label: value } } : n,
      ),
    ),
  );

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={120}
        minHeight={80}
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
