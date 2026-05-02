import type { NodeId } from '@conversensus/shared';
import {
  Handle,
  type NodeProps,
  NodeResizer,
  Position,
  useReactFlow,
} from '@xyflow/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveBlobUrl } from './atproto/blob';
import { currentDid } from './atproto/client';
import { useEventDispatch } from './EventDispatchContext';
import { makeEventBase } from './events/GraphEvent';
import { useInlineEdit } from './hooks/useInlineEdit';

type ImageNodeData = {
  label: string;
  conflicted: boolean;
  properties?: Record<string, unknown>;
};

export function ImageNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as ImageNodeData;
  const { getNode } = useReactFlow();
  const { dispatch } = useEventDispatch();

  const imageUrl = (nodeData.properties?.imageUrl as string) ?? '';
  const imageBlobCid = (nodeData.properties?.imageBlobCid as string) ?? '';
  const imageBlobMimeType =
    (nodeData.properties?.imageBlobMimeType as string) ?? '';
  const label = String(nodeData.label ?? '');
  const conflicted = nodeData.conflicted === true;

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
          to: { width: params.width, height: params.height },
        });
      }
    },
    [dispatch, id],
  );

  // Blob URL 解決
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (imageBlobCid && imageBlobMimeType) {
      console.log(
        '[ImageNode] resolving blob:',
        imageBlobCid,
        imageBlobMimeType,
      );
      const did = currentDid();
      resolveBlobUrl(did, imageBlobCid, imageBlobMimeType)
        .then((url) => {
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
          blobUrlRef.current = url;
          setBlobUrl(url);
          console.log('[ImageNode] blob resolved to:', url);
        })
        .catch((err) => {
          if (!cancelled)
            console.error('[ImageNode] blob resolve failed:', err);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [imageBlobCid, imageBlobMimeType]);

  // アンマウント時に Object URL を解放
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  // URL 入力
  const [editingUrl, setEditingUrl] = useState(false);
  const [urlInput, setUrlInput] = useState(imageUrl);
  const showUrlInput = editingUrl || (!imageUrl && !imageBlobCid);

  const commitUrl = useCallback(() => {
    const trimmed = urlInput.trim();
    if (trimmed === imageUrl) {
      setEditingUrl(false);
      return;
    }
    dispatch({
      ...makeEventBase('content'),
      type: 'NODE_PROPERTIES_CHANGED',
      nodeId: id as NodeId,
      from: { imageUrl },
      to: { imageUrl: trimmed },
    });
    setEditingUrl(false);
  }, [urlInput, imageUrl, dispatch, id]);

  // キャプション編集
  const caption = useInlineEdit(label, (value) => {
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

  useEffect(() => {
    setUrlInput(imageUrl);
  }, [imageUrl]);

  // 画像の読み込みエラー処理
  const [imgError, setImgError] = useState(false);
  const displayUrl = blobUrl ?? imageUrl;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 表示 URL 変更時にエラー状態をリセット
  useEffect(() => {
    setImgError(false);
  }, [displayUrl]);

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={120}
        minHeight={80}
        onResizeStart={onResizeStart}
        onResizeEnd={onResizeEnd}
      />
      <Handle type="source" position={Position.Top} id="source-top" />
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 6,
          border: conflicted ? '2px solid #f97316' : '1px solid #ccc',
          background: conflicted ? '#fff7ed' : '#fff',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* キャプションヘッダ */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: double-click to edit caption */}
        <div
          style={{
            padding: '3px 8px',
            borderBottom: '1px solid #eee',
            background: 'rgba(0,0,0,0.03)',
            borderRadius: '5px 5px 0 0',
            cursor: 'default',
            fontSize: 10,
            color: '#888',
            minHeight: 20,
            display: 'flex',
            alignItems: 'center',
          }}
          onDoubleClick={
            !caption.editing
              ? (e) => {
                  e.stopPropagation();
                  caption.startEdit();
                }
              : undefined
          }
        >
          {caption.editing ? (
            <input
              // biome-ignore lint/a11y/noAutofocus: needed for immediate caption entry
              autoFocus
              className="nodrag nopan"
              value={caption.inputValue}
              onChange={(e) => caption.setInputValue(e.target.value)}
              onBlur={caption.confirm}
              onCompositionStart={() => caption.setComposing(true)}
              onCompositionEnd={() => caption.setComposing(false)}
              onKeyDown={(e) => {
                if (caption.composingRef.current) return;
                if (e.key === 'Enter') caption.confirm();
                if (e.key === 'Escape') caption.cancel();
              }}
              style={{
                fontSize: 10,
                padding: '1px 3px',
                border: '1px solid #4f6ef7',
                borderRadius: 3,
                outline: 'none',
                width: '100%',
                boxSizing: 'border-box',
                background: '#fff',
              }}
            />
          ) : (
            <span>{label || ''}</span>
          )}
        </div>
        {/* 画像エリア */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: double-click to edit URL */}
        <div
          style={{
            flex: 1,
            background: '#f5f5f5',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}
          onDoubleClick={() => {
            setUrlInput(imageUrl);
            setEditingUrl(true);
          }}
        >
          {showUrlInput ? (
            <div style={{ padding: '4px', width: '100%' }}>
              <input
                // biome-ignore lint/a11y/noAutofocus: needed for immediate URL entry
                autoFocus={editingUrl}
                className="nodrag nopan"
                placeholder="画像URLを入力"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onBlur={commitUrl}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitUrl();
                  if (e.key === 'Escape') {
                    setUrlInput(imageUrl);
                    setEditingUrl(false);
                  }
                }}
                style={{
                  fontSize: 11,
                  padding: '4px 6px',
                  borderRadius: 3,
                  border: '1px solid #4f6ef7',
                  outline: 'none',
                  width: '100%',
                  boxSizing: 'border-box',
                  fontFamily: 'monospace',
                }}
              />
            </div>
          ) : imgError ? (
            <span style={{ fontSize: 11, color: '#999' }}>
              画像を読み込めません
            </span>
          ) : imageBlobCid && !blobUrl ? (
            <span style={{ fontSize: 11, color: '#999' }}>
              画像を読み込み中...
            </span>
          ) : (
            <img
              src={displayUrl}
              alt={label}
              onError={() => setImgError(true)}
              style={{
                width: '100%',
                height: 'auto',
                display: 'block',
              }}
              draggable={false}
            />
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} id="source-bottom" />
      <Handle type="source" position={Position.Left} id="source-left" />
      <Handle type="source" position={Position.Right} id="source-right" />
    </>
  );
}
