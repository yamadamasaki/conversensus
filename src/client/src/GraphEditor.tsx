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
  reconnectEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import '@xyflow/react/dist/style.css';
import type { GraphFile } from '@conversensus/shared';
import { EditableLabelEdge } from './EditableLabelEdge';
import { EditableNode } from './EditableNode';
import { GroupNode } from './GroupNode';
import {
  DEFAULT_NODE_STYLE,
  fromFlowEdges,
  fromFlowNodes,
  toFlowEdges,
  toFlowNodes,
} from './graphTransform';

const GROUP_PADDING = 20;
const GROUP_TITLE_HEIGHT = 30;

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

  const nodeTypes = useMemo(
    () => ({ editableNode: EditableNode, groupNode: GroupNode }),
    [],
  );
  const edgeTypes = useMemo(() => ({ editableLabel: EditableLabelEdge }), []);

  const onReconnect = useCallback(
    (
      oldEdge: Parameters<typeof reconnectEdge>[0],
      newConnection: Parameters<typeof reconnectEdge>[1],
    ) => setEdges((es) => reconnectEdge(oldEdge, newConnection, es)),
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

  const groupSelectedNodes = useCallback(() => {
    setNodes((ns) => {
      const selected = ns.filter((n) => n.selected);
      if (selected.length < 2) return ns;

      // 選択ノードのバウンディングボックスを計算 (絶対座標)
      const minX = Math.min(...selected.map((n) => n.position.x));
      const minY = Math.min(...selected.map((n) => n.position.y));
      const maxX = Math.max(
        ...selected.map(
          (n) =>
            n.position.x +
            Number(
              n.measured?.width ?? n.style?.width ?? DEFAULT_NODE_STYLE.width,
            ),
        ),
      );
      const maxY = Math.max(
        ...selected.map(
          (n) =>
            n.position.y +
            Number(
              n.measured?.height ??
                n.style?.height ??
                DEFAULT_NODE_STYLE.height,
            ),
        ),
      );

      const parentX = minX - GROUP_PADDING;
      const parentY = minY - GROUP_PADDING - GROUP_TITLE_HEIGHT;
      const parentWidth = maxX - minX + GROUP_PADDING * 2;
      const parentHeight = maxY - minY + GROUP_PADDING * 2 + GROUP_TITLE_HEIGHT;
      const parentId = crypto.randomUUID();

      const parentNode = {
        id: parentId,
        position: { x: parentX, y: parentY },
        data: { label: 'グループ' },
        type: 'groupNode' as const,
        style: { width: parentWidth, height: parentHeight, nodeType: 'group' },
      };

      const selectedIds = new Set(selected.map((n) => n.id));

      return [
        parentNode,
        ...ns.map((n) => {
          if (!selectedIds.has(n.id)) return n;
          return {
            ...n,
            parentId,
            selected: false,
            position: {
              x: n.position.x - parentX,
              y: n.position.y - parentY,
            },
          };
        }),
      ];
    });
  }, [setNodes]);

  // Cmd+G / Ctrl+G でグループ化
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'g') {
        e.preventDefault();
        groupSelectedNodes();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [groupSelectedNodes]);

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
        connectionMode="loose"
        onConnect={onConnect}
        onReconnect={onReconnect}
        edgesReconnectable
        onPaneDoubleClick={onPaneDoubleClick}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
        <Panel position="top-right">
          <div style={{ display: 'flex', gap: 8 }}>
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
          </div>
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
