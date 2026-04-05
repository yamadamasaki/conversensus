import type {
  EdgeId,
  EdgeLayout,
  EdgePathType,
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
  DEFAULT_NODE_STYLE,
  fromFlowEdges,
  fromFlowNodes,
  toFlowEdges,
  toFlowNodes,
} from './graphTransform';
import { useClipboard } from './hooks/useClipboard';
import { useEdgeContextMenu } from './hooks/useEdgeContextMenu';
import { useEventStore } from './hooks/useEventStore';
import { useGroupNodes } from './hooks/useGroupNodes';
import { usePaneDoubleClick } from './hooks/usePaneDoubleClick';

type Props = {
  file: GraphFile;
  activeSheetId: SheetId;
  onChange: (file: GraphFile) => void;
  conflictedNodeIds?: Set<string>;
  conflictedEdgeIds?: Set<string>;
};

function GraphEditorInner({
  file,
  activeSheetId,
  onChange,
  conflictedNodeIds,
  conflictedEdgeIds,
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

  // 初回マウント時の onChange 抑制フラグ
  const mounted = useRef(false);

  // file.id または activeSheetId が変わったとき React Flow の state をリセット
  // biome-ignore lint/correctness/useExhaustiveDependencies: file.id / activeSheetId の変化のみをトリガーにする意図的な設計
  useEffect(() => {
    mounted.current = false;
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
  }, [file.id, activeSheetId, setNodes, setEdges]);

  // コンフリクト状態が変わったらノード/エッジのスタイルだけ更新
  useEffect(() => {
    setNodes((current) =>
      current.map((n) => ({
        ...n,
        data: { ...n.data, conflicted: conflictedNodeIds?.has(n.id) ?? false },
      })),
    );
  }, [conflictedNodeIds, setNodes]);

  useEffect(() => {
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
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
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
    () => ({ editableNode: EditableNode, groupNode: GroupNode }),
    [],
  );
  const edgeTypes = useMemo(() => ({ editableLabel: EditableLabelEdge }), []);

  // --- Event store ---
  const { dispatch, undo, redo, setDragging } = useEventStore(
    nodes,
    edges,
    setNodes,
    setEdges,
  );

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

  const onNodeDragStop = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const from = preDragPositionsRef.current.get(node.id);
      if (from && (from.x !== node.position.x || from.y !== node.position.y)) {
        dispatch({
          ...makeEventBase('layout'),
          type: 'NODE_MOVED',
          nodeId: node.id as NodeId,
          from,
          to: {
            x: node.position.x,
            y: node.position.y,
          },
        });
      }
    },
    [dispatch],
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
        pathType: 'bezier' satisfies EdgePathType,
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
    const width = 1920;
    const height = 1080;
    const viewport = getViewportForBounds(bounds, width, height, 0.5, 2, 0.1);
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
