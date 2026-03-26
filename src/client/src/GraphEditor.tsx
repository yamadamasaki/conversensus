import {
  addEdge,
  Background,
  type Connection,
  ConnectionMode,
  Controls,
  type Edge,
  MarkerType,
  MiniMap,
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
import { GroupNode } from './GroupNode';
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
import { useGroupNodes } from './hooks/useGroupNodes';
import { usePaneDoubleClick } from './hooks/usePaneDoubleClick';

type Props = {
  file: GraphFile;
  onChange: (file: GraphFile) => void;
};

function GraphEditorInner({ file, onChange }: Props) {
  const { screenToFlowPosition, getNodes, getEdges } = useReactFlow();
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
  const edgeTypes = useMemo(() => ({ editableLabel: EditableLabelEdge }), []);

  // reconnectEdge は元の UUID を破棄して xy-edge__... 形式の ID を生成するため,
  // 元の ID を保持したまま接続先のみ更新する独自実装を使用する
  const onReconnect: OnReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) =>
      setEdges((es) =>
        es.map((e) =>
          e.id === oldEdge.id
            ? {
                ...e,
                source: newConnection.source,
                target: newConnection.target,
                sourceHandle: newConnection.sourceHandle,
                targetHandle: newConnection.targetHandle,
              }
            : e,
        ),
      ),
    [setEdges],
  );

  const onConnect: OnConnect = useCallback(
    // React Flow の自動生成 ID は UUID 形式でないため, 明示的に UUID を指定する
    (connection) =>
      setEdges((es) =>
        addEdge(
          {
            ...connection,
            id: crypto.randomUUID(),
            type: 'editableLabel',
            markerEnd: { type: MarkerType.ArrowClosed },
            data: { pathType: 'bezier' satisfies EdgePathType },
          },
          es,
        ),
      ),
    [setEdges],
  );

  const addNode = useCallback(
    (position?: { x: number; y: number }) => {
      const id = crypto.randomUUID();
      const pos = position ?? {
        x: 100 + Math.random() * 200,
        y: 100 + Math.random() * 200,
      };
      setNodes((ns) => [
        ...ns,
        {
          id,
          position: pos,
          data: { label: '' },
          type: 'editableNode',
          style: DEFAULT_NODE_STYLE,
        },
      ]);
    },
    [setNodes],
  );

  const onNodeDragStop = useCallback(() => {
    setNodes((ns) => recalculateParentBounds(ns));
  }, [setNodes]);

  // --- Custom hooks ---
  const { groupSelectedNodes } = useGroupNodes(setNodes);
  // Cmd+C / Cmd+V のキーボード登録は useClipboard 内で行われる
  useClipboard(getNodes, getEdges, setNodes, setEdges);
  const { contextMenu, onEdgeContextMenu, setEdgePathType } =
    useEdgeContextMenu(getEdges, setEdges);
  const { onPaneClick } = usePaneDoubleClick(screenToFlowPosition, addNode);

  return (
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
        onNodeDragStop={onNodeDragStop}
        edgesReconnectable
        onPaneClick={onPaneClick}
        onEdgeContextMenu={onEdgeContextMenu}
        zoomOnDoubleClick={false}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
        <Panel position="top-right">
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
        <EdgeContextMenu contextMenu={contextMenu} onSelect={setEdgePathType} />
      )}
    </div>
  );
}

export function GraphEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <GraphEditorInner {...props} />
    </ReactFlowProvider>
  );
}
