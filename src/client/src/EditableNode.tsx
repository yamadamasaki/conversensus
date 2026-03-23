import {
  Handle,
  type NodeProps,
  NodeResizer,
  Position,
  useReactFlow,
} from '@xyflow/react';
import { useCallback, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { recalculateParentBounds } from './graphTransform';

export function EditableNode({ id, data, selected }: NodeProps) {
  const { setNodes } = useReactFlow();
  const onResizeEnd = useCallback(
    () => setNodes((ns) => recalculateParentBounds(ns)),
    [setNodes],
  );
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  // Escape 後の onBlur で confirm が呼ばれないようにするフラグ
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
        minWidth={80}
        minHeight={40}
        onResizeEnd={onResizeEnd}
      />
      <Handle type="target" position={Position.Top} id="target-top" />
      <Handle type="target" position={Position.Left} id="target-left" />
      <Handle type="target" position={Position.Right} id="target-right" />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: ノードコンテナはダブルクリックで編集を開始する */}
      <div
        style={{
          padding: '8px 12px',
          borderRadius: 6,
          border: '1px solid #ccc',
          background: '#fff',
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          overflow: 'auto',
          cursor: 'default',
        }}
        onDoubleClick={!editing ? startEdit : undefined}
      >
        {editing ? (
          <textarea
            // biome-ignore lint/a11y/noAutofocus: ノード編集開始時に即座に入力できるよう autoFocus が必要
            autoFocus
            className="nodrag nopan"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onBlur={confirm}
            onKeyDown={(e) => {
              if (e.key === 'Escape') cancel();
            }}
            style={{
              fontSize: 12,
              padding: '2px 4px',
              borderRadius: 3,
              border: '1px solid #4f6ef7',
              outline: 'none',
              width: '100%',
              height: '100%',
              boxSizing: 'border-box',
              resize: 'none',
              fontFamily: 'monospace',
            }}
          />
        ) : (
          <div
            style={{
              fontSize: 12,
              lineHeight: 1.6,
            }}
            className="markdown-body"
          >
            {label ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{label}</ReactMarkdown>
            ) : (
              <span style={{ color: '#aaa' }}>ダブルクリックで編集</span>
            )}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} id="source-bottom" />
      <Handle type="source" position={Position.Left} id="source-left" />
      <Handle type="source" position={Position.Right} id="source-right" />
    </>
  );
}
