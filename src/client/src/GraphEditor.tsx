import {
  addEdge,
  Background,
  Controls,
  MarkerType,
  MiniMap,
  type OnConnect,
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
import { EditableLabelEdge } from './EditableLabelEdge';
import { EditableNode } from './EditableNode';
import {
  fromFlowEdges,
  fromFlowNodes,
  toFlowEdges,
  toFlowNodes,
} from './graphTransform';

type Props = {
  file: GraphFile;
  onChange: (file: GraphFile) => void;
};

function GraphEditorInner({ file, onChange }: Props) {
  const { screenToFlowPosition } = useReactFlow();
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

  const nodeTypes = useMemo(() => ({ editableNode: EditableNode }), []);
  const edgeTypes = useMemo(() => ({ editableLabel: EditableLabelEdge }), []);

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
          data: { label: '新しいノード' },
          type: 'editableNode',
        },
      ]);
    },
    [setNodes],
  );

  const onPaneDoubleClick = useCallback(
    (e: MouseEvent) => {
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addNode(pos);
    },
    [screenToFlowPosition, addNode],
  );

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onPaneDoubleClick={onPaneDoubleClick}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
        <Panel position="top-right">
          <button
            type="button"
            onClick={() => addNode()}
            style={{
              padding: '6px 12px',
              fontSize: 13,
              cursor: 'pointer',
              background: '#4f6ef7',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
            }}
          >
            + ノードを追加
          </button>
        </Panel>
      </ReactFlow>
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
