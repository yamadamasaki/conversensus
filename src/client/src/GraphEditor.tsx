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
import { EditableLabelEdge } from './EditableLabelEdge';
import { EditableNode } from './EditableNode';
import { GroupNode } from './GroupNode';
import {
  DEFAULT_NODE_STYLE,
  fromFlowEdges,
  fromFlowNodes,
  GROUP_PADDING,
  GROUP_TITLE_HEIGHT,
  recalculateParentBounds,
  toFlowEdges,
  toFlowNodes,
} from './graphTransform';

const DOUBLE_CLICK_INTERVAL_MS = 300;
const DOUBLE_CLICK_THRESHOLD_PX = 5;

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
      if (selected.length < 1) return ns;

      // 選択ノードが同じ親を持つ場合, その親の中にグループを作る
      const sharedParentId = selected.every(
        (n) => n.parentId === selected[0].parentId,
      )
        ? selected[0].parentId
        : undefined;

      // 選択ノードのバウンディングボックスを計算 (sharedParentId がある場合は相対座標)
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
        parentId: sharedParentId,
        style: { width: parentWidth, height: parentHeight, nodeType: 'group' },
      };

      const selectedIds = new Set(selected.map((n) => n.id));

      const mappedNodes = ns.map((n) => {
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
      });

      // React Flow では親ノードを子ノードより前に配置する必要がある
      // ネスト時は sharedParentId の直後に挿入する
      if (sharedParentId) {
        const idx = mappedNodes.findIndex((n) => n.id === sharedParentId);
        const insertAt = idx >= 0 ? idx + 1 : 0;
        return [
          ...mappedNodes.slice(0, insertAt),
          parentNode,
          ...mappedNodes.slice(insertAt),
        ];
      }

      return [parentNode, ...mappedNodes];
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

  const onNodeDragStop = useCallback(() => {
    setNodes((ns) => recalculateParentBounds(ns));
  }, [setNodes]);

  const lastPaneClickTime = useRef(0);
  const lastPaneClickPos = useRef({ x: 0, y: 0 });

  const onPaneClick = useCallback(
    (e: React.MouseEvent) => {
      const now = Date.now();
      const dx = e.clientX - lastPaneClickPos.current.x;
      const dy = e.clientY - lastPaneClickPos.current.y;
      const isSameSpot =
        Math.abs(dx) < DOUBLE_CLICK_THRESHOLD_PX &&
        Math.abs(dy) < DOUBLE_CLICK_THRESHOLD_PX;
      if (
        now - lastPaneClickTime.current < DOUBLE_CLICK_INTERVAL_MS &&
        isSameSpot
      ) {
        const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        addNode(pos);
        lastPaneClickTime.current = 0;
      } else {
        lastPaneClickTime.current = now;
        lastPaneClickPos.current = { x: e.clientX, y: e.clientY };
      }
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
        connectionMode={ConnectionMode.Loose}
        onConnect={onConnect}
        onReconnect={onReconnect}
        onNodeDragStop={onNodeDragStop}
        edgesReconnectable
        onPaneClick={onPaneClick}
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
