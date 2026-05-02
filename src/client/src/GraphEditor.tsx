import type {
  EdgeId,
  EdgeLayout,
  GraphEdge,
  GraphNode,
  NodeId,
  NodeLayout,
  SheetId,
} from '@conversensus/shared';
import {
  Background,
  type Connection,
  ConnectionMode,
  Controls,
  type Edge,
  type EdgeChange,
  getNodesBounds,
  getViewportForBounds,
  MiniMap,
  type Node,
  type NodeChange,
  type OnConnect,
  type OnReconnect,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import { toPng } from 'html-to-image';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import '@xyflow/react/dist/style.css';
import type { GraphFile } from '@conversensus/shared';
import {
  cacheBlobUrl,
  createImageDataUrl,
  uploadImageBlob,
} from './atproto/blob';
import { EdgeContextMenu } from './EdgeContextMenu';
import { EditableLabelEdge } from './EditableLabelEdge';
import { EditableNode } from './EditableNode';
import { EventDispatchContext } from './EventDispatchContext';
import { makeEventBase } from './events/GraphEvent';
import { GroupNode } from './GroupNode';
import {
  DEFAULT_EDGE_PATH_TYPE,
  DEFAULT_NODE_STYLE,
  fromFlowEdges,
  fromFlowNodes,
  GROUP_NODE_TYPE,
  IMAGE_NODE_TYPE,
  PNG_EXPORT_HEIGHT,
  PNG_EXPORT_MAX_ZOOM,
  PNG_EXPORT_MIN_ZOOM,
  PNG_EXPORT_PADDING,
  PNG_EXPORT_WIDTH,
  RF_GROUP_NODE_TYPE,
  RF_IMAGE_NODE_TYPE,
  toFlowAndGhostEdges,
  toFlowAndGhostNodes,
} from './graphTransform';
import { useClipboard } from './hooks/useClipboard';
import { useEdgeContextMenu } from './hooks/useEdgeContextMenu';
import { type UndoState, useEventStore } from './hooks/useEventStore';
import { useGroupNodes } from './hooks/useGroupNodes';
import { usePaneDoubleClick } from './hooks/usePaneDoubleClick';
import { ImageNode } from './ImageNode';
import type { NodeTypeOption } from './NodeTypeMenu';
import { NodeTypeMenu } from './NodeTypeMenu';

const RF_INIT_DELAY_MS = 150;
const DROP_TARGET_ATTR = 'data-drop-target'; // グループへ追加しようとしている
const LEAVING_GROUP_ATTR = 'data-leaving-group'; // グループを出ようとしている

// measured と style の大きい方を採用することで recalculateParentBounds 後の
// 非同期 DOM 再計測とのズレに対して安定した境界値を返す
function getGroupBounds(g: Node) {
  const styleW = typeof g.style?.width === 'number' ? g.style.width : 0;
  const styleH = typeof g.style?.height === 'number' ? g.style.height : 0;
  return {
    x: g.positionAbsolute?.x ?? g.position.x,
    y: g.positionAbsolute?.y ?? g.position.y,
    w: Math.max(g.measured?.width ?? 0, styleW) || 300,
    h: Math.max(g.measured?.height ?? 0, styleH) || 200,
  };
}

function pointInGroup(
  cx: number,
  cy: number,
  g: Node,
  bufX = 0,
  bufY = bufX,
): boolean {
  const { x, y, w, h } = getGroupBounds(g);
  return (
    cx >= x - bufX && cx <= x + w + bufX && cy >= y - bufY && cy <= y + h + bufY
  );
}

function isAncestorOf(
  candidateId: string,
  targetId: string,
  nodes: Node[],
): boolean {
  const t = nodes.find((n) => n.id === targetId);
  if (!t?.parentId) return false;
  if (t.parentId === candidateId) return true;
  return isAncestorOf(candidateId, t.parentId, nodes);
}

function clearDragHighlights(): void {
  for (const attr of [DROP_TARGET_ATTR, LEAVING_GROUP_ATTR]) {
    for (const el of document.querySelectorAll(`[${attr}="true"]`)) {
      el.removeAttribute(attr);
    }
  }
}

type Props = {
  file: GraphFile;
  activeSheetId: SheetId;
  onChange: (file: GraphFile) => void;
  addedNodeIds?: Set<string>;
  updatedNodeIds?: Set<string>;
  addedEdgeIds?: Set<string>;
  updatedEdgeIds?: Set<string>;
  deletedNodes?: GraphNode[];
  deletedEdges?: GraphEdge[];
  deletedNodeLayouts?: NodeLayout[];
  deletedEdgeLayouts?: EdgeLayout[];
  graphKey?: string;
  undoStateMap?: React.MutableRefObject<Map<string, UndoState>>;
};

function GraphEditorInner({
  file,
  activeSheetId,
  onChange,
  addedNodeIds,
  updatedNodeIds,
  addedEdgeIds,
  updatedEdgeIds,
  deletedNodes,
  deletedEdges,
  deletedNodeLayouts,
  deletedEdgeLayouts,
  graphKey,
  undoStateMap,
}: Props) {
  const { screenToFlowPosition, getNodes, getEdges } = useReactFlow();
  const activeSheet = file.sheets.find((s) => s.id === activeSheetId);

  const ghostDeletedNodeIds = useMemo(
    () => new Set((deletedNodes ?? []).map((n) => n.id)),
    [deletedNodes],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(
    toFlowAndGhostNodes(
      activeSheet?.nodes ?? [],
      activeSheet?.layouts ?? [],
      deletedNodes ?? [],
      deletedNodeLayouts ?? [],
      addedNodeIds,
      updatedNodeIds,
    ),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    toFlowAndGhostEdges(
      activeSheet?.edges ?? [],
      activeSheet?.edgeLayouts ?? [],
      deletedEdges ?? [],
      deletedEdgeLayouts ?? [],
      ghostDeletedNodeIds,
      addedEdgeIds,
      updatedEdgeIds,
    ),
  );

  // 常に最新の file / activeSheetId / onChange / deleted items を参照するための ref
  const fileRef = useRef(file);
  fileRef.current = file;
  const activeSheetIdRef = useRef(activeSheetId);
  activeSheetIdRef.current = activeSheetId;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const deletedNodesRef = useRef(deletedNodes);
  deletedNodesRef.current = deletedNodes;
  const deletedEdgesRef = useRef(deletedEdges);
  deletedEdgesRef.current = deletedEdges;
  const deletedNodeLayoutsRef = useRef(deletedNodeLayouts);
  deletedNodeLayoutsRef.current = deletedNodeLayouts;
  const deletedEdgeLayoutsRef = useRef(deletedEdgeLayouts);
  deletedEdgeLayoutsRef.current = deletedEdgeLayouts;

  // sheet/file 切り替え後、ReactFlow の初期化 (dimensions 計測) が完了するまで
  // onChange を抑制するフラグ。ReactFlow はノード数分だけ dimensions 変更を発火するため
  // 1回スキップの mounted フラグでは不十分 → タイマーで抑制期間を設ける。
  const readyForSave = useRef(false);
  // コンフリクトスタイル更新 (見た目のみ) による onChange 誤発火を抑制するフラグ
  const conflictUpdatePendingRef = useRef(false);

  // file.id または activeSheetId が変わったとき React Flow の state をリセット
  // biome-ignore lint/correctness/useExhaustiveDependencies: file.id / activeSheetId の変化のみをトリガーにする意図的な設計
  useEffect(() => {
    readyForSave.current = false;
    const sheet = fileRef.current.sheets.find(
      (s) => s.id === activeSheetIdRef.current,
    );
    setNodes(
      toFlowAndGhostNodes(
        sheet?.nodes ?? [],
        sheet?.layouts ?? [],
        deletedNodesRef.current ?? [],
        deletedNodeLayoutsRef.current ?? [],
        addedNodeIds,
        updatedNodeIds,
      ),
    );
    setEdges(
      toFlowAndGhostEdges(
        sheet?.edges ?? [],
        sheet?.edgeLayouts ?? [],
        deletedEdgesRef.current ?? [],
        deletedEdgeLayoutsRef.current ?? [],
        new Set((deletedNodesRef.current ?? []).map((n) => n.id)),
        addedEdgeIds,
        updatedEdgeIds,
      ),
    );
    // ReactFlow の初期 dimensions 計測が完了するまで onChange を抑制 (150ms)
    const t = setTimeout(() => {
      readyForSave.current = true;
    }, RF_INIT_DELAY_MS);
    return () => clearTimeout(t);
  }, [file.id, activeSheetId, setNodes, setEdges]);

  // コンフリクト状態が変わったらノード/エッジのスタイルだけ更新
  // NOTE: setNodes/setEdges は nodes/edges state を変化させるため onChange effect が
  // 発火する。これはデータ変更ではなくスタイル変更なので conflictUpdatePendingRef で抑制する。
  useEffect(() => {
    conflictUpdatePendingRef.current = true;
    setNodes((current) =>
      current.map((n) => {
        const dt: 'add' | 'update' | undefined = addedNodeIds?.has(n.id)
          ? 'add'
          : updatedNodeIds?.has(n.id)
            ? 'update'
            : undefined;
        return {
          ...n,
          data: { ...n.data, diffType: dt },
        };
      }),
    );
  }, [addedNodeIds, updatedNodeIds, setNodes]);

  useEffect(() => {
    conflictUpdatePendingRef.current = true;
    setEdges((current) =>
      current.map((e) => {
        const added = addedEdgeIds?.has(e.id) ?? false;
        const updated = updatedEdgeIds?.has(e.id) ?? false;
        const dt: 'add' | 'update' | undefined = added
          ? 'add'
          : updated
            ? 'update'
            : undefined;
        return {
          ...e,
          style: dt
            ? {
                stroke: dt === 'add' ? '#16a34a' : '#f97316',
                strokeWidth: 3,
              }
            : undefined,
          data: { ...e.data, diffType: dt },
        };
      }),
    );
  }, [addedEdgeIds, updatedEdgeIds, setEdges]);

  // 削除ノード/エッジが変わったらゴーストを同期
  useEffect(() => {
    conflictUpdatePendingRef.current = true;
    setNodes((current) => {
      const active = current.filter((n) => !n.data?.ghost);
      const ghosts = toFlowAndGhostNodes(
        [],
        [],
        deletedNodes ?? [],
        deletedNodeLayouts ?? [],
      );
      return [...active, ...ghosts];
    });
  }, [deletedNodes, deletedNodeLayouts, setNodes]);

  useEffect(() => {
    conflictUpdatePendingRef.current = true;
    const dnIds = new Set((deletedNodes ?? []).map((n) => n.id));
    setEdges((current) => {
      const active = current.filter((e) => !e.data?.ghost);
      const ghosts = toFlowAndGhostEdges(
        [],
        [],
        deletedEdges ?? [],
        deletedEdgeLayouts ?? [],
        dnIds,
      );
      return [...active, ...ghosts];
    });
  }, [deletedNodes, deletedEdges, deletedEdgeLayouts, setEdges]);

  // nodes/edges が変わったら親に通知
  useEffect(() => {
    // コンフリクトスタイル更新 (見た目のみ) の場合は onChange を呼ばない
    // readyForSave より先にチェックして pending フラグを必ずリセットする
    if (conflictUpdatePendingRef.current) {
      conflictUpdatePendingRef.current = false;
      return;
    }
    // 初期化フェーズ (ReactFlow dimension 計測中) は onChange を呼ばない
    if (!readyForSave.current) return;
    const currentSheetId = activeSheetIdRef.current;
    // ゴーストノード/エッジを除外（保存対象外）
    const activeNodes = nodes.filter((n) => !n.data?.ghost);
    const activeEdges = edges.filter((e) => !e.data?.ghost);
    const { nodes: graphNodes, layouts } = fromFlowNodes(activeNodes);
    const { edges: graphEdges, edgeLayouts } = fromFlowEdges(activeEdges);
    onChangeRef.current({
      ...fileRef.current,
      sheets: fileRef.current.sheets.map((s) =>
        s.id === currentSheetId
          ? { ...s, nodes: graphNodes, layouts, edges: graphEdges, edgeLayouts }
          : s,
      ),
    });
  }, [nodes, edges]);

  const nodeTypes = useMemo(
    () => ({
      editableNode: EditableNode,
      [RF_GROUP_NODE_TYPE]: GroupNode,
      [RF_IMAGE_NODE_TYPE]: ImageNode,
    }),
    [],
  );
  const edgeTypes = useMemo(() => ({ editableLabel: EditableLabelEdge }), []);

  // --- Event store ---
  const { dispatch, undo, redo, setDragging, exportState, importState } =
    useEventStore(nodes, edges, setNodes, setEdges);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount/unmount のみ (React key 変更による再マウント)
  useEffect(() => {
    if (!graphKey || !undoStateMap) return;
    const key = graphKey;
    const saved = undoStateMap.current.get(key);
    if (saved) {
      importState(saved);
    }
    return () => {
      undoStateMap.current.set(key, exportState());
    };
  }, []);

  // --- Node drag tracking for NODE_MOVED ---
  const preDragPositionsRef = useRef<Map<string, { x: number; y: number }>>(
    new Map(),
  );

  const onNodeDragStart = useCallback(
    (_: React.MouseEvent, _node: Node) => {
      const currentNodes = getNodes();
      preDragPositionsRef.current = new Map(
        currentNodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }]),
      );
    },
    [getNodes],
  );

  // ドラッグ中: ビジュアルフィードバック
  const onNodeDrag = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const allNodes = getNodes();
      // positionAbsolute は非同期更新のため stale の可能性がある。
      // 子ノードは 親.positionAbsolute + node.position(相対) で正確な絶対座標を算出する。
      const parentInStore = node.parentId
        ? allNodes.find((n) => n.id === node.parentId)
        : undefined;
      const absX = parentInStore
        ? (parentInStore.positionAbsolute?.x ?? parentInStore.position.x) +
          node.position.x
        : (node.positionAbsolute?.x ?? node.position.x);
      const absY = parentInStore
        ? (parentInStore.positionAbsolute?.y ?? parentInStore.position.y) +
          node.position.y
        : (node.positionAbsolute?.y ?? node.position.y);
      const nodeW = Number(node.measured?.width ?? DEFAULT_NODE_STYLE.width);
      const nodeH = Number(node.measured?.height ?? DEFAULT_NODE_STYLE.height);
      const cx = absX + nodeW / 2;
      const cy = absY + nodeH / 2;

      clearDragHighlights();

      const oldParentId = node.parentId;
      if (oldParentId) {
        // 子ノードのドラッグ: 親グループの外に出ているなら赤でハイライト
        const parent = allNodes.find((n) => n.id === oldParentId);
        if (parent && !pointInGroup(cx, cy, parent)) {
          document
            .querySelector(`.react-flow__node[data-id="${oldParentId}"]`)
            ?.setAttribute(LEAVING_GROUP_ATTR, 'true');
          // 別グループへ移動しようとしているならそちらもオレンジでハイライト
          const targetGroup = allNodes
            .filter(
              (n) =>
                n.type === RF_GROUP_NODE_TYPE &&
                n.id !== node.id &&
                n.id !== oldParentId,
            )
            .find((g) => {
              if (isAncestorOf(g.id, node.id, allNodes)) return false;
              return pointInGroup(cx, cy, g);
            });
          if (targetGroup) {
            document
              .querySelector(`.react-flow__node[data-id="${targetGroup.id}"]`)
              ?.setAttribute(DROP_TARGET_ATTR, 'true');
          }
        }
      } else {
        // トップレベルノードのドラッグ: 入ろうとしているグループをハイライト
        const target = allNodes
          .filter((n) => n.type === RF_GROUP_NODE_TYPE && n.id !== node.id)
          .find((g) => {
            if (isAncestorOf(g.id, node.id, allNodes)) return false;
            return pointInGroup(cx, cy, g);
          });
        if (target) {
          document
            .querySelector(`.react-flow__node[data-id="${target.id}"]`)
            ?.setAttribute(DROP_TARGET_ATTR, 'true');
        }
      }
    },
    [getNodes],
  );

  const onNodeDragStop = useCallback(
    (_: React.MouseEvent, node: Node) => {
      clearDragHighlights();

      const from = preDragPositionsRef.current.get(node.id);
      const allNodes = getNodes();

      const oldParentId = node.parentId as NodeId | undefined;

      // positionAbsolute は非同期更新のため stale の可能性がある。
      // 子ノードは 親.positionAbsolute + node.position(相対) で正確な絶対座標を算出する。
      const parentInStore = oldParentId
        ? allNodes.find((n) => n.id === oldParentId)
        : undefined;
      const absX = parentInStore
        ? (parentInStore.positionAbsolute?.x ?? parentInStore.position.x) +
          node.position.x
        : (node.positionAbsolute?.x ?? node.position.x);
      const absY = parentInStore
        ? (parentInStore.positionAbsolute?.y ?? parentInStore.position.y) +
          node.position.y
        : (node.positionAbsolute?.y ?? node.position.y);
      const nodeW = Number(node.measured?.width ?? DEFAULT_NODE_STYLE.width);
      const nodeH = Number(node.measured?.height ?? DEFAULT_NODE_STYLE.height);
      const cx = absX + nodeW / 2;
      const cy = absY + nodeH / 2;
      let newParentId: NodeId | undefined;

      if (oldParentId) {
        // 既にグループ内: ノード自身の幅/高さの半分をバッファとして使い
        // 「ノードがグループをほぼ完全に出た」ときだけ離脱とみなす
        const currentParent = allNodes.find((n) => n.id === oldParentId);
        if (
          currentParent &&
          pointInGroup(cx, cy, currentParent, nodeW / 2, nodeH / 2)
        ) {
          newParentId = oldParentId;
        } else {
          // 明らかに親の外: 別グループへの移動か、完全離脱
          const other = allNodes
            .filter(
              (n) =>
                n.type === RF_GROUP_NODE_TYPE &&
                n.id !== node.id &&
                n.id !== oldParentId,
            )
            .find((g) => {
              if (isAncestorOf(g.id, node.id, allNodes)) return false;
              return pointInGroup(cx, cy, g);
            });
          newParentId = other?.id as NodeId | undefined;
        }
      } else {
        // トップレベル: グループへの追加を検出
        const target = allNodes
          .filter((n) => n.type === RF_GROUP_NODE_TYPE && n.id !== node.id)
          .find((g) => {
            if (isAncestorOf(g.id, node.id, allNodes)) return false;
            return pointInGroup(cx, cy, g);
          });
        newParentId = target?.id as NodeId | undefined;
      }

      if (newParentId !== oldParentId) {
        const targetGroup = newParentId
          ? allNodes.find((n) => n.id === newParentId)
          : undefined;
        const newPosition = targetGroup
          ? {
              x:
                absX -
                (targetGroup.positionAbsolute?.x ?? targetGroup.position.x),
              y:
                absY -
                (targetGroup.positionAbsolute?.y ?? targetGroup.position.y),
            }
          : { x: absX, y: absY };
        dispatch({
          ...makeEventBase('structure'),
          type: 'NODE_REPARENTED',
          nodeId: node.id as NodeId,
          oldParentId,
          newParentId,
          oldPosition: from ?? node.position,
          newPosition,
        });
      } else if (
        from &&
        (from.x !== node.position.x || from.y !== node.position.y)
      ) {
        dispatch({
          ...makeEventBase('layout'),
          type: 'NODE_MOVED',
          nodeId: node.id as NodeId,
          from,
          to: { x: node.position.x, y: node.position.y },
        });
      }
    },
    [dispatch, getNodes],
  );

  // reconnectEdge は元の UUID を破棄して xy-edge__... 形式の ID を生成するため,
  // 元の ID を保持したまま接続先のみ更新する独自実装を使用する
  const onReconnect: OnReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      dispatch({
        ...makeEventBase('structure'),
        type: 'EDGE_RECONNECTED',
        edgeId: oldEdge.id as EdgeId,
        from: {
          source: oldEdge.source as NodeId,
          target: oldEdge.target as NodeId,
          sourceHandle: oldEdge.sourceHandle ?? undefined,
          targetHandle: oldEdge.targetHandle ?? undefined,
        },
        to: {
          source: newConnection.source as NodeId,
          target: newConnection.target as NodeId,
          sourceHandle: newConnection.sourceHandle ?? undefined,
          targetHandle: newConnection.targetHandle ?? undefined,
        },
      });
    },
    [dispatch],
  );

  const onConnect: OnConnect = useCallback(
    (connection) => {
      const edgeId = crypto.randomUUID() as EdgeId;
      const graphEdge: GraphEdge = {
        id: edgeId,
        source: connection.source as NodeId,
        target: connection.target as NodeId,
      };
      const edgeLayout: EdgeLayout = {
        edgeId,
        sourceHandle: connection.sourceHandle ?? undefined,
        targetHandle: connection.targetHandle ?? undefined,
        pathType: DEFAULT_EDGE_PATH_TYPE,
      };
      dispatch({
        ...makeEventBase('structure'),
        type: 'EDGE_ADDED',
        edgeId,
        data: graphEdge,
        edgeLayout,
      });
    },
    [dispatch],
  );

  const addNode = useCallback(
    (
      position?: { x: number; y: number },
      nodeType?: NodeTypeOption,
      properties?: Record<string, unknown>,
    ) => {
      const nodeId = crypto.randomUUID() as NodeId;
      const pos = position ?? {
        x: 100 + Math.random() * 200,
        y: 100 + Math.random() * 200,
      };
      const graphNode: GraphNode = {
        id: nodeId,
        content: '',
        ...(nodeType === 'group' ? { nodeType: GROUP_NODE_TYPE } : {}),
        ...(nodeType === 'image' ? { nodeType: IMAGE_NODE_TYPE } : {}),
        ...(properties ? { properties } : {}),
      };
      const layout: NodeLayout = {
        nodeId,
        x: pos.x,
        y: pos.y,
        ...DEFAULT_NODE_STYLE,
      };
      dispatch({
        ...makeEventBase('structure'),
        type: 'NODE_ADDED',
        nodeId,
        data: graphNode,
        layout,
      });
    },
    [dispatch],
  );

  // Delete/Backspace で選択ノード・エッジを削除
  // React Flow の組み込み削除を無効化し, dispatch 経由で処理する
  const handleDeleteKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const currentNodes = getNodes();
      const currentEdges = getEdges();
      const selectedNodes = currentNodes.filter((n) => n.selected);
      const selectedEdges = currentEdges.filter((e) => e.selected);

      for (const node of selectedNodes) {
        const { nodes: graphNodes } = fromFlowNodes([node]);
        dispatch({
          ...makeEventBase('structure'),
          type: 'NODE_DELETED',
          nodeId: node.id as NodeId,
          data: graphNodes[0],
        });
      }
      for (const edge of selectedEdges) {
        const { edges: graphEdges, edgeLayouts } = fromFlowEdges([edge]);
        dispatch({
          ...makeEventBase('structure'),
          type: 'EDGE_DELETED',
          edgeId: edge.id as EdgeId,
          data: graphEdges[0],
          edgeLayout: edgeLayouts[0],
        });
      }
    },
    [getNodes, getEdges, dispatch],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleDeleteKey);
    return () => window.removeEventListener('keydown', handleDeleteKey);
  }, [handleDeleteKey]);

  // クリップボードからの画像貼り付け → ImageNode 作成
  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item.type.startsWith('image/')) continue;
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        try {
          const buf = await file.arrayBuffer();
          const bytes = new Uint8Array(buf);
          const blobRef = await uploadImageBlob(bytes.slice(), file.type);
          cacheBlobUrl(blobRef.cid, bytes, blobRef.mimeType);
          const containerEl = document.querySelector('.react-flow');
          let pos = {
            x: 100 + Math.random() * 200,
            y: 100 + Math.random() * 200,
          };
          if (containerEl) {
            const rect = containerEl.getBoundingClientRect();
            pos = screenToFlowPosition({
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
            });
          }
          addNode(pos, 'image', {
            imageBlobCid: blobRef.cid,
            imageBlobMimeType: blobRef.mimeType,
            imageDataUrl: createImageDataUrl(bytes, blobRef.mimeType),
          });
        } catch (err) {
          console.error('[GraphEditor] paste image upload failed:', err);
        }
        break;
      }
    },
    [screenToFlowPosition, addNode],
  );

  useEffect(() => {
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

  // Ctrl/Cmd+V で navigator.clipboard.read() を使う代替パス
  // (非編集可能要素では paste イベントが発火しないブラウザがあるため)
  const handlePasteKeydown = useCallback(
    async (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'v') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      try {
        const clipboardItems = await navigator.clipboard.read();
        for (const item of clipboardItems) {
          for (const type of item.types) {
            if (!type.startsWith('image/')) continue;
            const imageBlob = await item.getType(type);
            const buf = await imageBlob.arrayBuffer();
            const bytes = new Uint8Array(buf);
            const blobRef = await uploadImageBlob(bytes.slice(), type);
            cacheBlobUrl(blobRef.cid, bytes, blobRef.mimeType);
            const containerEl = document.querySelector('.react-flow');
            let pos = {
              x: 100 + Math.random() * 200,
              y: 100 + Math.random() * 200,
            };
            if (containerEl) {
              const rect = containerEl.getBoundingClientRect();
              pos = screenToFlowPosition({
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2,
              });
            }
            addNode(pos, 'image', {
              imageBlobCid: blobRef.cid,
              imageBlobMimeType: blobRef.mimeType,
              imageDataUrl: createImageDataUrl(bytes, blobRef.mimeType),
            });
            e.preventDefault();
          }
        }
      } catch {
        // clipboard read 失敗（許可がない場合など）は paste イベントに任せる
      }
    },
    [screenToFlowPosition, addNode],
  );

  useEffect(() => {
    window.addEventListener('keydown', handlePasteKeydown);
    return () => window.removeEventListener('keydown', handlePasteKeydown);
  }, [handlePasteKeydown]);

  // ファイルドロップ → ImageNode 作成
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      const files = e.dataTransfer.files;
      if (files.length === 0) return;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.type.startsWith('image/')) continue;
        e.preventDefault();
        try {
          const buf = await file.arrayBuffer();
          const bytes = new Uint8Array(buf);
          const blobRef = await uploadImageBlob(bytes.slice(), file.type);
          cacheBlobUrl(blobRef.cid, bytes, blobRef.mimeType);
          const pos = screenToFlowPosition({
            x: e.clientX,
            y: e.clientY,
          });
          addNode(pos, 'image', {
            imageBlobCid: blobRef.cid,
            imageBlobMimeType: blobRef.mimeType,
            imageDataUrl: createImageDataUrl(bytes, blobRef.mimeType),
          });
        } catch (err) {
          console.error('[GraphEditor] drop image upload failed:', err);
        }
        break;
      }
    },
    [screenToFlowPosition, addNode],
  );

  // remove タイプの変更は dispatch 経由で処理するためフィルタする
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes.filter((c) => c.type !== 'remove'));
    },
    [onNodesChange],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      onEdgesChange(changes.filter((c) => c.type !== 'remove'));
    },
    [onEdgesChange],
  );

  // --- Custom hooks ---
  const { groupSelectedNodes } = useGroupNodes(getNodes, dispatch);
  useClipboard(getNodes, getEdges, dispatch);
  const { contextMenu, onEdgeContextMenu, setEdgePathType } =
    useEdgeContextMenu(getEdges, dispatch);
  const { onPaneClick, nodeTypeMenu, clearNodeTypeMenu } =
    usePaneDoubleClick(screenToFlowPosition);

  // --- PNG export ---
  const handleExportPng = useCallback(() => {
    const nodes = getNodes();
    const bounds = getNodesBounds(nodes);
    const width = PNG_EXPORT_WIDTH;
    const height = PNG_EXPORT_HEIGHT;
    const viewport = getViewportForBounds(
      bounds,
      width,
      height,
      PNG_EXPORT_MIN_ZOOM,
      PNG_EXPORT_MAX_ZOOM,
      PNG_EXPORT_PADDING,
    );
    const viewportEl = document.querySelector(
      '.react-flow__viewport',
    ) as HTMLElement | null;
    if (!viewportEl) return;
    toPng(viewportEl, {
      backgroundColor: '#ffffff',
      width,
      height,
      style: {
        width: String(width),
        height: String(height),
        transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
      },
    }).then((dataUrl) => {
      const a = document.createElement('a');
      a.href = dataUrl;
      const sheetName =
        fileRef.current.sheets.find((s) => s.id === activeSheetIdRef.current)
          ?.name ?? 'sheet';
      const safeName = `${fileRef.current.name} - ${sheetName}`.replace(
        /[/\\:*?"<>|]/g,
        '_',
      );
      a.download = `${safeName}.png`;
      a.click();
    });
  }, [getNodes]);

  return (
    <EventDispatchContext.Provider value={{ dispatch, setDragging }}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drop target wrapper */}
      <div
        style={{ width: '100%', height: '100%' }}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          connectionMode={ConnectionMode.Loose}
          onConnect={onConnect}
          onReconnect={onReconnect}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          edgesReconnectable
          onPaneClick={onPaneClick}
          onEdgeContextMenu={onEdgeContextMenu}
          zoomOnDoubleClick={false}
          deleteKeyCode={null}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap />
          <Panel position="top-right">
            <button
              type="button"
              onClick={undo}
              style={{
                padding: '6px 12px',
                fontSize: 13,
                cursor: 'pointer',
                background: '#e0e0e0',
                color: '#333',
                border: 'none',
                borderRadius: 6,
                marginRight: 4,
              }}
            >
              Undo
            </button>
            <button
              type="button"
              onClick={redo}
              style={{
                padding: '6px 12px',
                fontSize: 13,
                cursor: 'pointer',
                background: '#e0e0e0',
                color: '#333',
                border: 'none',
                borderRadius: 6,
                marginRight: 8,
              }}
            >
              Redo
            </button>
            <button
              type="button"
              onClick={groupSelectedNodes}
              style={{
                padding: '6px 12px',
                fontSize: 13,
                cursor: 'pointer',
                background: '#7c9ef8',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
              }}
            >
              グループ化
            </button>
            <button
              type="button"
              onClick={handleExportPng}
              style={{
                padding: '6px 12px',
                fontSize: 13,
                cursor: 'pointer',
                background: '#e0e0e0',
                color: '#333',
                border: 'none',
                borderRadius: 6,
                marginLeft: 8,
              }}
            >
              PNG
            </button>
          </Panel>
        </ReactFlow>
        {nodeTypeMenu && (
          <NodeTypeMenu
            position={nodeTypeMenu.screenPos}
            onSelect={(nodeType) => {
              addNode(nodeTypeMenu.flowPos, nodeType);
              clearNodeTypeMenu();
            }}
          />
        )}
        {contextMenu && (
          <EdgeContextMenu
            contextMenu={contextMenu}
            onSelect={setEdgePathType}
          />
        )}
      </div>
    </EventDispatchContext.Provider>
  );
}

export function GraphEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <GraphEditorInner {...props} />
    </ReactFlowProvider>
  );
}

export type { Props as GraphEditorProps };
