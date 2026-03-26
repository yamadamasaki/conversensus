import type {
  EdgeId,
  EdgePathType,
  GraphEdge,
  GraphNode,
  NodeId,
} from '@conversensus/shared';
import {
  Background,
  type Connection,
  ConnectionMode,
  Controls,
  type Edge,
  MiniMap,
  type Node,
  type OnConnect,
  type OnReconnect,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import '@xyflow/react/dist/style.css';
import type { GraphFile } from '@conversensus/shared';
import { EdgeContextMenu } from './EdgeContextMenu';
import { EditableLabelEdge } from './EditableLabelEdge';
import { EditableNode } from './EditableNode';
import { EventDispatchContext } from './EventDispatchContext';
import { GroupNode } from './GroupNode';
import { makeEventBase } from './events/GraphEvent';
import {
  DEFAULT_NODE_STYLE,
  fromFlowEdges,
  fromFlowNodes,
  recalculateParentBounds,
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
  onChange: (file: GraphFile) => void;
};

function GraphEditorInner({ file, onChange }: Props) {
  const { screenToFlowPosition, getNodes, getEdges } =
    useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState(
    toFlowNodes(file.sheet.nodes),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    toFlowEdges(file.sheet.edges),
  );

  // 常に最新の file / onChange を参照するための ref
  const fileRef = useRef(file);
  fileRef.current = file;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // 初回マウント時の onChange 抑制フラグ
  const mounted = useRef(false);

  // file.id が変わったとき (ファイル切り替え) だけ React Flow の state をリセット
  // biome-ignore lint/correctness/useExhaustiveDependencies: file.id の変化のみをトリガーにする意図的な設計
  useEffect(() => {
    mounted.current = false;
    setNodes(toFlowNodes(fileRef.current.sheet.nodes));
    setEdges(toFlowEdges(fileRef.current.sheet.edges));
  }, [file.id, setNodes, setEdges]);

  // nodes/edges が変わったら親に通知
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    onChangeRef.current({
      ...fileRef.current,
      sheet: {
        ...fileRef.current.sheet,
        nodes: fromFlowNodes(nodes),
        edges: fromFlowEdges(edges),
      },
    });
  }, [nodes, edges]);

  const nodeTypes = useMemo(
    () => ({ editableNode: EditableNode, groupNode: GroupNode }),
    [],
  );
  const edgeTypes = useMemo(
    () => ({ editableLabel: EditableLabelEdge }),
    [],
  );

  // --- Event store ---
  const { dispatch, undo, redo } = useEventStore(
    nodes,
    edges,
    setNodes,
    setEdges,
  );

  // --- Node drag tracking for NODE_MOVED ---
  const preDragPositionsRef = useRef<
    Map<string, { x: number; y: number }>
  >(new Map());

  const onNodeDragStart = useCallback(
    (_: React.MouseEvent, _node: Node) => {
      const currentNodes = getNodes();
      preDragPositionsRef.current = new Map(
        currentNodes.map((n) => [
          n.id,
          { x: n.position.x, y: n.position.y },
        ]),
      );
    },
    [getNodes],
  );

  const onNodeDragStop = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setNodes((ns) => recalculateParentBounds(ns));
      const from = preDragPositionsRef.current.get(node.id);
      if (
        from &&
        (from.x !== node.position.x ||
          from.y !== node.position.y)
      ) {
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
    [setNodes, dispatch],
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
          sourceHandle:
            newConnection.sourceHandle ?? undefined,
          targetHandle:
            newConnection.targetHandle ?? undefined,
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
        sourceHandle: connection.sourceHandle ?? undefined,
        targetHandle: connection.targetHandle ?? undefined,
        pathType: 'bezier' satisfies EdgePathType,
      };
      dispatch({
        ...makeEventBase('structure'),
        type: 'EDGE_ADDED',
        edgeId,
        data: graphEdge,
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
        style: { x: pos.x, y: pos.y, ...DEFAULT_NODE_STYLE },
      };
      dispatch({
        ...makeEventBase('structure'),
        type: 'NODE_ADDED',
        nodeId,
        data: graphNode,
      });
    },
    [dispatch],
  );

  // Delete/Backspace で選択ノード・エッジを削除
  // React Flow の組み込み削除を無効化し, dispatch 経由で処理する
  const handleDeleteKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace')
        return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const currentNodes = getNodes();
      const currentEdges = getEdges();
      const selectedNodes = currentNodes.filter(
        (n) => n.selected,
      );
      const selectedEdges = currentEdges.filter(
        (e) => e.selected,
      );

      for (const node of selectedNodes) {
        const graphNodes = fromFlowNodes([node]);
        dispatch({
          ...makeEventBase('structure'),
          type: 'NODE_DELETED',
          nodeId: node.id as NodeId,
          data: graphNodes[0],
        });
      }
      for (const edge of selectedEdges) {
        const graphEdges = fromFlowEdges([edge]);
        dispatch({
          ...makeEventBase('structure'),
          type: 'EDGE_DELETED',
          edgeId: edge.id as EdgeId,
          data: graphEdges[0],
        });
      }
    },
    [getNodes, getEdges, dispatch],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleDeleteKey);
    return () =>
      window.removeEventListener('keydown', handleDeleteKey);
  }, [handleDeleteKey]);

  // --- Custom hooks ---
  const { groupSelectedNodes } = useGroupNodes(
    getNodes,
    dispatch,
  );
  useClipboard(getNodes, getEdges, dispatch);
  const { contextMenu, onEdgeContextMenu, setEdgePathType } =
    useEdgeContextMenu(getEdges, dispatch);
  const { onPaneClick } = usePaneDoubleClick(
    screenToFlowPosition,
    addNode,
  );

  return (
    <EventDispatchContext.Provider value={dispatch}>
      <div style={{ width: '100%', height: '100%' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
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
