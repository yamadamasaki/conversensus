import { Handle, type NodeProps, Position, useReactFlow } from '@xyflow/react';
import { useCallback, useState } from 'react';

export function EditableNode({ id, data }: NodeProps) {
  const { setNodes } = useReactFlow();
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [composing, setComposing] = useState(false);

  const label = String(data.label ?? '');

  const startEdit = useCallback(() => {
    setInputValue(label);
    setEditing(true);
  }, [label]);

  const confirm = useCallback(() => {
    setNodes((ns) =>
      ns.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, label: inputValue } } : n,
      ),
    );
    setEditing(false);
  }, [id, inputValue, setNodes]);

  const cancel = useCallback(() => {
    setInputValue(label);
    setEditing(false);
  }, [label]);

  return (
    <>
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
          minWidth: 80,
          textAlign: 'center',
          cursor: 'default',
        }}
        onDoubleClick={!editing ? startEdit : undefined}
      >
        {editing ? (
          <input
            // biome-ignore lint/a11y/noAutofocus: ノード編集開始時に即座に入力できるよう autoFocus が必要
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
              fontSize: 14,
              padding: '2px 4px',
              borderRadius: 3,
              border: '1px solid #4f6ef7',
              outline: 'none',
              width: '100%',
              minWidth: 60,
              textAlign: 'center',
            }}
          />
        ) : (
          <span
            style={{
              fontSize: 14,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {label}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} id="source-bottom" />
      <Handle type="source" position={Position.Left} id="source-left" />
      <Handle type="source" position={Position.Right} id="source-right" />
    </>
  );
}
