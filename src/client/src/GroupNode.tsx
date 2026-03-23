import {
  Handle,
  type NodeProps,
  NodeResizer,
  Position,
  useReactFlow,
} from '@xyflow/react';
import { useCallback, useRef, useState } from 'react';
import { recalculateParentBounds } from './graphTransform';

export function GroupNode({ id, data, selected }: NodeProps) {
  const { setNodes } = useReactFlow();
  const onResizeEnd = useCallback(
    () => setNodes((ns) => recalculateParentBounds(ns)),
    [setNodes],
  );
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [composing, setComposing] = useState(false);
  const cancelledRef = useRef(false);

  const label = String(data.label ?? '');

  const startEdit = useCallback(() => {
    cancelledRef.current = false;
    setInputValue(label);
    setEditing(true);
  }, [label]);

  const confirm = useCallback(() => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    setNodes((ns) =>
      ns.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, label: inputValue } } : n,
      ),
    );
    setEditing(false);
  }, [id, inputValue, setNodes]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setInputValue(label);
    setEditing(false);
  }, [label]);

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
        type="target"
        position={Position.Top}
        id="target-top"
        style={{ zIndex: 10, pointerEvents: 'all' }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="source-bottom"
        style={{ zIndex: 10, pointerEvents: 'all' }}
      />
      <Handle
        type="target"
        position={Position.Bottom}
        id="target-bottom"
        style={{ zIndex: 10, pointerEvents: 'all' }}
      />
      <Handle
        type="source"
        position={Position.Left}
        id="source-left"
        style={{ zIndex: 10, pointerEvents: 'all' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="target-left"
        style={{ zIndex: 10, pointerEvents: 'all' }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="source-right"
        style={{ zIndex: 10, pointerEvents: 'all' }}
      />
      <Handle
        type="target"
        position={Position.Right}
        id="target-right"
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
          onDoubleClick={!editing ? startEdit : undefined}
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
        <div style={{ flex: 1 }} />
      </div>
    </>
  );
}
