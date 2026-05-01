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
  GROUP_PADDING,
  PNG_EXPORT_HEIGHT,
  PNG_EXPORT_MAX_ZOOM,
  PNG_EXPORT_MIN_ZOOM,
  PNG_EXPORT_PADDING,
  PNG_EXPORT_WIDTH,
  RF_GROUP_NODE_TYPE,
  toFlowEdges,
  toFlowNodes,
} from './graphTransform';
import { useClipboard } from './hooks/useClipboard';
import { useEdgeContextMenu } from './hooks/useEdgeContextMenu';
import { type UndoState, useEventStore } from './hooks/useEventStore';
import { useGroupNodes } from './hooks/useGroupNodes';
import { usePaneDoubleClick } from './hooks/usePaneDoubleClick';

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
  conflictedNodeIds?: Set<string>;
  conflictedEdgeIds?: Set<string>;
  graphKey?: string;
  undoStateMap?: React.MutableRefObject<Map<string, UndoState>>;
};

function GraphEditorInner({
  file,
  activeSheetId,
  onChange,
  conflictedNodeIds,
  conflictedEdgeIds,
  graphKey,
  undoStateMap,
}: Props) {
  const { screenToFlowPosition, getNodes, getEdges } = useReactFlow();
  const activeSheet = file.sheets.find((s) => s.id === activeSheetId);
  const [nodes, setNodes, onNodesChange] = useNodesState(
    toFlowNodes(
      activeSheet?.nodes ?? [],
      activeSheet?.layouts ?? [],
      conflictedNodeIds,
    ),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    toFlowEdges(
      activeSheet?.edges ?? [],
      activeSheet?.edgeLayouts ?? [],
      conflictedEdgeIds,
    ),
  );

  // 常に最新の file / activeSheetId / onChange を参照するための ref
  const fileRef = useRef(file);
  fileRef.current = file;
  const activeSheetIdRef = useRef(activeSheetId);
  activeSheetIdRef.current = activeSheetId;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

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
      toFlowNodes(sheet?.nodes ?? [], sheet?.layouts ?? [], conflictedNodeIds),
    );
    setEdges(
      toFlowEdges(
        sheet?.edges ?? [],
        sheet?.edgeLayouts ?? [],
        conflictedEdgeIds,
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
      current.map((n) => ({
        ...n,
        data: { ...n.data, conflicted: conflictedNodeIds?.has(n.id) ?? false },
      })),
    );
  }, [conflictedNodeIds, setNodes]);

  useEffect(() => {
    conflictUpdatePendingRef.current = true;
    setEdges((current) =>
      current.map((e) => {
        const conflicted = conflictedEdgeIds?.has(e.id) ?? false;
        return {
          ...e,
          style: conflicted ? { stroke: '#f97316', strokeWidth: 3 } : undefined,
          data: { ...e.data, conflicted },
        };
      }),
    );
  }, [conflictedEdgeIds, setEdges]);

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
    const { nodes: graphNodes, layouts } = fromFlowNodes(nodes);
    const { edges: graphEdges, edgeLayouts } = fromFlowEdges(edges);
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
    () => ({ editableNode: EditableNode, [RF_GROUP_NODE_TYPE]: GroupNode }),
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
      const absX = node.positionAbsolute?.x ?? node.position.x;
      const absY = node.positionAbsolute?.y ?? node.position.y;
      const nodeW = Number(node.measured?.width ?? DEFAULT_NODE_STYLE.width);
      const nodeH = Number(node.measured?.height ?? DEFAULT_NODE_STYLE.height);
      const cx = absX + nodeW / 2;
      const cy = absY + nodeH / 2;

      clearDragHighlights();

      const oldParentId = node.parentId;
      if (oldParentId) {
        // 子ノードのドラッグ: 親グループの外に出ているならオレンジ枠で "出る" 予告
        const parent = allNodes.find((n) => n.id === oldParentId);
        if (parent && !pointInGroup(cx, cy, parent)) {
          document
            .querySelector(`.react-flow__node[data-id="${oldParentId}"]`)
            ?.setAttribute(LEAVING_GROUP_ATTR, 'true');
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

      const absX = node.positionAbsolute?.x ?? node.position.x;
      const absY = node.positionAbsolute?.y ?? node.position.y;
      const nodeW = Number(node.measured?.width ?? DEFAULT_NODE_STYLE.width);
      const nodeH = Number(node.measured?.height ?? DEFAULT_NODE_STYLE.height);
      const cx = absX + nodeW / 2;
      const cy = absY + nodeH / 2;

      const oldParentId = node.parentId as NodeId | undefined;
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
    (position?: { x: number; y: number }) => {
      const nodeId = crypto.randomUUID() as NodeId;
      const pos = position ?? {
        x: 100 + Math.random() * 200,
        y: 100 + Math.random() * 200,
      };
      const graphNode: GraphNode = {
        id: nodeId,
        content: '',
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
  const { onPaneClick } = usePaneDoubleClick(screenToFlowPosition, addNode);

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
      <div style={{ width: '100%', height: '100%' }}>
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
