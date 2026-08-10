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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '@xyflow/react/dist/style.css';
import type { GraphFile } from '@conversensus/shared';
import { AlertDialog } from './AlertDialog';
import { EdgeContextMenu } from './EdgeContextMenu';
import { EditableLabelEdge } from './EditableLabelEdge';
import { EditableNode } from './EditableNode';
import { EventDispatchContext } from './EventDispatchContext';
import { type GraphEvent, makeEventBase } from './events/GraphEvent';
import { GroupNode } from './GroupNode';
import { deletionTargets } from './graph/deletion';
import {
  buildDragStopEvents,
  draggedNodesOf,
  resolveDropTargets,
} from './graph/dragStop';
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
import { useNodeTypeMenu } from './hooks/useNodeTypeMenu';
import { ImageNode } from './ImageNode';
import { imagePropertiesOf, saveImageBlob } from './images/imageBlob';
import { NodeCreationContext } from './NodeCreationContext';
import type { NodeTypeOption } from './NodeTypeMenu';
import { NodeTypeMenu } from './NodeTypeMenu';

const RF_INIT_DELAY_MS = 150;
const IMAGE_MIME_PREFIX = 'image/';
const DROP_TARGET_ATTR = 'data-drop-target'; // グループへ追加しようとしている
const LEAVING_GROUP_ATTR = 'data-leaving-group'; // グループを出ようとしている

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
  // ファイル単位の操作ログ tap (W3c1)。App から渡され content 編集を op-log へ流す。
  // sheetId は content batch へ付与される (W3c2)。
  syncRecord: (event: GraphEvent, sheetId?: SheetId) => void;
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
  // 受信 swap の世代番号 (Phase 4e-3/4e-4)。同一 file.id のまま activeFile が受信で
  // 差し替わったとき、この値の増加を契機に React Flow の state を再 seed する。
  receiveEpoch?: number;
};

function GraphEditorInner({
  file,
  activeSheetId,
  onChange,
  syncRecord,
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
  receiveEpoch,
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

  // 画像の受け入れに失敗した理由 (上限超過・保存失敗)。App へ持ち上げず GraphEditor 内で
  // 出す — 既に 14 個ある GraphEditorProps をこのために増やす理由が無い
  const [imageError, setImageError] = useState<string | null>(null);

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

  // file.id / activeSheetId が変わったとき、および受信 swap (receiveEpoch の増加,
  // Phase 4e-3) のとき React Flow の state をリセットする。受信 swap は file.id が
  // 同一のままファイル内容が差し替わるため、epoch を依存に入れないと画面に出ない
  // (4e-4 実機で発見)。swap は reprojectAfterReceive が「編集中でない・pending 0」を
  // 保証した後にしか起きないので、ここで無条件に再 seed してよい。
  // biome-ignore lint/correctness/useExhaustiveDependencies: file.id / activeSheetId / receiveEpoch の変化のみをトリガーにする意図的な設計
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
  }, [file.id, activeSheetId, receiveEpoch, setNodes, setEdges]);

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
  // dispatch された event を操作ログへ流す tap (W2)。tap はファイル単位で App が保持し
  // syncRecord として渡される (W3c1: content と structure が単一 tap を共有)。
  // content 編集はこの GraphEditor が表示する単一シートに属すため activeSheetId を付与する (W3c2)。
  const recordContent = useCallback(
    (event: GraphEvent) => syncRecord(event, activeSheetId),
    [syncRecord, activeSheetId],
  );
  const { dispatch, undo, redo, setDragging, exportState, importState } =
    useEventStore(nodes, edges, setNodes, setEdges, recordContent);

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
    (_: React.MouseEvent, node: Node, nodes: Node[]) => {
      const dragged = draggedNodesOf(node, nodes);
      clearDragHighlights();

      // 確定時 (onNodeDragStop) と同じ関数で解決し、ハイライトと実際の移動先を揃える
      const targets = resolveDropTargets(dragged, getNodes());

      for (const draggedNode of dragged) {
        const target = targets.get(draggedNode.id);
        const oldParentId = draggedNode.parentId;
        if (target?.id === oldParentId) continue;

        // 親グループから出ようとしている: 元の親を赤でハイライト
        if (oldParentId) {
          document
            .querySelector(`.react-flow__node[data-id="${oldParentId}"]`)
            ?.setAttribute(LEAVING_GROUP_ATTR, 'true');
        }
        // 入ろうとしているグループをオレンジでハイライト
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
    (_: React.MouseEvent, node: Node, nodes: Node[]) => {
      clearDragHighlights();

      const events = buildDragStopEvents(
        draggedNodesOf(node, nodes),
        getNodes(),
        preDragPositionsRef.current,
      );
      for (const event of events) dispatch(event);
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
      // 生成先のグループ。指定時 position はそのグループから見た相対座標
      parentId?: NodeId,
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
        ...(parentId ? { parentId } : {}),
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
      const doomed = deletionTargets(currentNodes, currentEdges);
      if (doomed.nodes.length === 0 && doomed.edges.length === 0) return;

      // 1 イベントにまとめる。グループと子を別々のイベントで消すと,
      // undo の途中で親の居ない子が現れてしまう
      const { nodes: graphNodes, layouts } = fromFlowNodes(doomed.nodes);
      const { edges: graphEdges, edgeLayouts } = fromFlowEdges(doomed.edges);
      dispatch({
        ...makeEventBase('structure'),
        type: 'NODES_DELETED',
        nodeIds: doomed.nodes.map((n) => n.id as NodeId),
        edgeIds: doomed.edges.map((edge) => edge.id as EdgeId),
        nodes: graphNodes,
        layouts,
        edges: graphEdges,
        edgeLayouts,
      });
    },
    [getNodes, getEdges, dispatch],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleDeleteKey);
    return () => window.removeEventListener('keydown', handleDeleteKey);
  }, [handleDeleteKey]);

  // 画像の受け入れ (ANA-116 S3)。drop / paste / Cmd+V の 3 経路が共有する。
  //
  // **判断は `images/imageBlob.ts` にある** — ここが持つのは配線と位置決めだけである。
  // 保存先はローカル blob ストアで、PDS は触らない (未ログインでも使えるため。設計 D5)。
  const addImageNode = useCallback(
    async (source: Blob, position: { x: number; y: number }) => {
      try {
        const ref = await saveImageBlob(source);
        addNode(position, 'image', imagePropertiesOf(ref));
      } catch (err) {
        // 握り潰さない (設計 D7)。旧実装は console.error だけだったので、
        // 上限超過は「落としたのに何も起きない」ようにしか見えなかった
        setImageError(err instanceof Error ? err.message : String(err));
      }
    },
    [addNode],
  );

  // 貼り付けの落とし先。canvas の中央に置く
  const pasteTargetPosition = useCallback(() => {
    const containerEl = document.querySelector('.react-flow');
    if (!containerEl) {
      return { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 };
    }
    const rect = containerEl.getBoundingClientRect();
    return screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
  }, [screenToFlowPosition]);

  // クリップボードからの画像貼り付け → ImageNode 作成
  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item.type.startsWith(IMAGE_MIME_PREFIX)) continue;
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        await addImageNode(file, pasteTargetPosition());
        break;
      }
    },
    [pasteTargetPosition, addImageNode],
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

      let clipboardItems: ClipboardItems;
      try {
        clipboardItems = await navigator.clipboard.read();
      } catch {
        // clipboard read 失敗 (許可がない場合など) は paste イベントに任せる。
        // **保存の失敗をここで一緒に捨ててはならない** — 旧実装はこの catch が
        // 広すぎて、上限超過も権限エラーも同じく黙って消えていた
        return;
      }

      for (const item of clipboardItems) {
        for (const type of item.types) {
          if (!type.startsWith(IMAGE_MIME_PREFIX)) continue;
          e.preventDefault();
          const source = await item.getType(type);
          await addImageNode(source, pasteTargetPosition());
        }
      }
    },
    [pasteTargetPosition, addImageNode],
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
        if (!file.type.startsWith(IMAGE_MIME_PREFIX)) continue;
        e.preventDefault();
        // 落とした位置は React の合成イベントが再利用される前に確定させる
        const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        await addImageNode(file, position);
        break;
      }
    },
    [screenToFlowPosition, addImageNode],
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
  const { groupSelectedNodes, ungroupSelectedNodes } = useGroupNodes(
    getNodes,
    dispatch,
  );
  useClipboard(getNodes, getEdges, dispatch);
  const { contextMenu, onEdgeContextMenu, setEdgePathType } =
    useEdgeContextMenu(getEdges, dispatch);
  const { onPaneClick, openNodeTypeMenu, nodeTypeMenu, clearNodeTypeMenu } =
    useNodeTypeMenu(screenToFlowPosition, getNodes);

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
      <NodeCreationContext.Provider value={{ openNodeTypeMenu }}>
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
                onClick={ungroupSelectedNodes}
                style={{
                  padding: '6px 12px',
                  fontSize: 13,
                  cursor: 'pointer',
                  background: '#7c9ef8',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  marginLeft: 4,
                }}
              >
                グループ解除
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
                addNode(
                  nodeTypeMenu.position,
                  nodeType,
                  undefined,
                  nodeTypeMenu.containerId,
                );
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
          {imageError && (
            <AlertDialog
              message={imageError}
              onClose={() => setImageError(null)}
            />
          )}
        </div>
      </NodeCreationContext.Provider>
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
