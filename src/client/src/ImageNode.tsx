import type { NodeId } from '@conversensus/shared';
import {
  Handle,
  type NodeProps,
  NodeResizer,
  Position,
  useReactFlow,
} from '@xyflow/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEventDispatch } from './EventDispatchContext';
import { makeEventBase } from './events/GraphEvent';
import { useInlineEdit } from './hooks/useInlineEdit';
import {
  IMAGE_MIME_PREFIX,
  imagePropertiesChange,
  LEGACY_DATA_URL_KEY,
  readImageBlobLocation,
  resolveImageUrl,
  saveImageBlob,
} from './images/imageBlob';
import {
  imageErrorMessage,
  useReportImageError,
} from './images/imageErrorContext';

type ImageNodeData = {
  label: string;
  diffType?: 'add' | 'update';
  properties?: Record<string, unknown>;
  ghost?: boolean;
};

export function ImageNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as ImageNodeData;
  const { getNode } = useReactFlow();
  const { dispatch } = useEventDispatch();

  const imageUrl = (nodeData.properties?.imageUrl as string) ?? '';
  // 旧データの読み取り互換。新規には書かない (設計 D1 / §7)
  const imageDataUrl =
    (nodeData.properties?.[LEGACY_DATA_URL_KEY] as string) ?? '';
  // 新形式の blob ref と旧形式の flat なキーの両方をここで吸収する
  const location = readImageBlobLocation(nodeData.properties);
  // effect の依存は原始値にする — properties のオブジェクトは再レンダリングごとに
  // 同一性が変わりうるので、そのまま依存に置くと解決が回り続ける
  const blobCid = location?.cid ?? '';
  const blobMimeType = location?.mimeType ?? '';
  const label = String(nodeData.label ?? '');
  const diffType = nodeData.diffType as 'add' | 'update' | undefined;
  const ghost = nodeData.ghost === true;

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

  // blob の実体の解決 (設計 D4 の 1〜3)。順序そのものは images/imageBlob.ts が持つ
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  // このノードが作った Object URL。共有キャッシュ由来のものは他のノードも
  // 表示に使っているので、ここに入れない (revoke すると相手の画像が壊れる)
  const ownedUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!blobCid || !blobMimeType) return;
    let cancelled = false;

    resolveImageUrl({ cid: blobCid, mimeType: blobMimeType })
      .then((resolved) => {
        // どこにも無ければ旧データ (imageDataUrl / imageUrl) へ落ちる
        if (!resolved) return;
        if (cancelled) {
          if (!resolved.fromCache) URL.revokeObjectURL(resolved.url);
          return;
        }
        if (ownedUrlRef.current) URL.revokeObjectURL(ownedUrlRef.current);
        ownedUrlRef.current = resolved.fromCache ? null : resolved.url;
        setResolvedUrl(resolved.url);
      })
      .catch((err) => {
        if (!cancelled) console.error('[ImageNode] blob resolve failed:', err);
      });

    return () => {
      cancelled = true;
    };
  }, [blobCid, blobMimeType]);

  // アンマウント時に自前の Object URL を解放する
  useEffect(() => {
    return () => {
      if (ownedUrlRef.current) URL.revokeObjectURL(ownedUrlRef.current);
    };
  }, []);

  // 既存ノードへの画像 drop (ANA-117 S6)。落とされた画像でこのノードを差し替える。
  //
  // **canvas の `onDrop` (新規ノード作成) と二重に発火させない** — 落とし先が
  // ノードの上なら差し替えが利用者の意図なので、ここで伝播を止める。
  const reportImageError = useReportImageError();
  const properties = nodeData.properties;

  const replaceImage = useCallback(
    async (source: Blob) => {
      try {
        const ref = await saveImageBlob(source);
        dispatch({
          ...makeEventBase('content'),
          type: 'NODE_PROPERTIES_CHANGED',
          nodeId: id as NodeId,
          ...imagePropertiesChange(properties, ref),
        });
      } catch (err) {
        reportImageError(imageErrorMessage(err));
      }
    },
    [dispatch, id, properties, reportImageError],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    // preventDefault しないとブラウザが drop を受け付けない。stopPropagation は
    // canvas 側の dragover と競合させないため
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      const file = Array.from(e.dataTransfer.files).find((f) =>
        f.type.startsWith(IMAGE_MIME_PREFIX),
      );
      if (!file) return; // 画像でなければ canvas 側に任せる (伝播を止めない)
      e.preventDefault();
      e.stopPropagation();
      void replaceImage(file);
    },
    [replaceImage],
  );

  // URL 入力
  const [editingUrl, setEditingUrl] = useState(false);
  const [urlInput, setUrlInput] = useState(imageUrl);
  const showUrlInput = editingUrl || (!imageUrl && !blobCid && !imageDataUrl);

  const commitUrl = useCallback(() => {
    const trimmed = urlInput.trim();
    if (trimmed === imageUrl) {
      setEditingUrl(false);
      return;
    }
    // **差分ではなく全体を載せる** — `node.setProperties` は置換意味論なので、
    // `{ imageUrl }` だけを載せると同じノードの画像 blob 参照まで消える
    dispatch({
      ...makeEventBase('content'),
      type: 'NODE_PROPERTIES_CHANGED',
      nodeId: id as NodeId,
      from: { ...properties },
      to: { ...properties, imageUrl: trimmed },
    });
    setEditingUrl(false);
  }, [urlInput, imageUrl, properties, dispatch, id]);

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
  // 解決順序 (設計 D4): blob (1〜3) → 旧 imageDataUrl (4) → imageUrl (5)
  const displayUrl = resolvedUrl || imageDataUrl || imageUrl;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 表示 URL 変更時にエラー状態をリセット
  useEffect(() => {
    setImgError(false);
  }, [displayUrl]);

  if (ghost) {
    // ghost のハンドルは ghost エッジの端点として座標を提供するだけで、
    // ここから新しいエッジを引くことはできない (ANA-121)
    return (
      <>
        <Handle
          type="source"
          position={Position.Top}
          id="source-top"
          isConnectable={false}
        />
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 6,
            border: '1px dashed #aaa',
            background: 'rgba(0,0,0,0.02)',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '3px 8px',
              borderBottom: '1px solid #eee',
              background: 'rgba(0,0,0,0.03)',
              borderRadius: '5px 5px 0 0',
              fontSize: 10,
              color: '#999',
              minHeight: 20,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ textDecoration: 'line-through' }}>
              {label || ''}
            </span>
          </div>
          <div
            style={{
              flex: 1,
              background: '#f5f5f5',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ fontSize: 11, color: '#aaa' }}>画像</span>
          </div>
        </div>
        <Handle
          type="source"
          position={Position.Bottom}
          id="source-bottom"
          isConnectable={false}
        />
        <Handle
          type="source"
          position={Position.Left}
          id="source-left"
          isConnectable={false}
        />
        <Handle
          type="source"
          position={Position.Right}
          id="source-right"
          isConnectable={false}
        />
      </>
    );
  }

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
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drop to replace the image (ANA-117) */}
      <div
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 6,
          border: diffType
            ? diffType === 'add'
              ? '2px solid #16a34a'
              : '2px solid #f97316'
            : '1px solid #ccc',
          background: diffType
            ? diffType === 'add'
              ? '#f0fdf4'
              : '#fff7ed'
            : '#fff',
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
          ) : blobCid && !displayUrl ? (
            <span style={{ fontSize: 11, color: '#999' }}>
              画像を読み込み中...
            </span>
          ) : displayUrl ? (
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
          ) : null}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} id="source-bottom" />
      <Handle type="source" position={Position.Left} id="source-left" />
      <Handle type="source" position={Position.Right} id="source-right" />
    </>
  );
}
