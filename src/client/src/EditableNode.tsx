import type { NodeId } from '@conversensus/shared';
import {
  Handle,
  type NodeProps,
  NodeResizer,
  Position,
  useReactFlow,
} from '@xyflow/react';
import { useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useEventDispatch } from './EventDispatchContext';
import { makeEventBase } from './events/GraphEvent';
import { recalculateParentBounds } from './graphTransform';
import { useInlineEdit } from './hooks/useInlineEdit';

export function EditableNode({ id, data, selected }: NodeProps) {
  const { setNodes, getNode } = useReactFlow();
  const dispatch = useEventDispatch();

  // onResizeStart で現在のサイズを保存
  const preSizeRef = useRef({ width: 0, height: 0 });

  const onResizeStart = useCallback(() => {
    const node = getNode(id);
    if (node) {
      preSizeRef.current = {
        width: Number(
          node.measured?.width ??
            node.style?.width ??
            0,
        ),
        height: Number(
          node.measured?.height ??
            node.style?.height ??
            0,
        ),
      };
    }
  }, [getNode, id]);

  const onResizeEnd = useCallback(
    (
      _event: unknown,
      params: { width: number; height: number },
    ) => {
      setNodes((ns) => recalculateParentBounds(ns));
      const from = preSizeRef.current;
      if (
        from.width !== params.width ||
        from.height !== params.height
      ) {
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
    [setNodes, dispatch, id],
  );

  const label = String(data.label ?? '');

  const { editing, inputValue, setInputValue, startEdit, confirm, cancel } =
    useInlineEdit(label, (value) => {
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
        minWidth={80}
        minHeight={40}
        onResizeStart={onResizeStart}
        onResizeEnd={onResizeEnd}
      />
      <Handle type="source" position={Position.Top} id="source-top" />
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
