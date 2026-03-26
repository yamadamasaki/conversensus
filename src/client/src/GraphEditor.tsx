import {
  addEdge,
  Background,
  type Connection,
  ConnectionMode,
  Controls,
  type Edge,
  MarkerType,
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '@xyflow/react/dist/style.css';
import type { EdgePathType, GraphFile } from '@conversensus/shared';
import { EditableLabelEdge } from './EditableLabelEdge';
import { EditableNode } from './EditableNode';
import { GroupNode } from './GroupNode';
import {
  buildPastedData,
  collectCopyData,
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
const PASTE_OFFSET_PX = 20;

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
            data: { pathType: 'bezier' },
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

  const clipboard = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null);

  const copySelectedNodes = useCallback(() => {
    const copied = collectCopyData(getNodes(), getEdges());
    if (copied.nodes.length > 0) clipboard.current = copied;
  }, [getNodes, getEdges]);

  const pasteNodes = useCallback(() => {
    if (!clipboard.current) return;
    const { nodes: newNodes, edges: newEdges } = buildPastedData(
      clipboard.current,
      PASTE_OFFSET_PX,
    );
    setNodes((ns) => [
      ...ns.map((n) => ({ ...n, selected: false })),
      ...newNodes,
    ]);
    setEdges((es) => [...es, ...newEdges]);
    // 次の貼り付けがさらにオフセットされるようクリップボードを更新
    clipboard.current = { nodes: newNodes, edges: newEdges };
  }, [setNodes, setEdges]);

  // Cmd+C / Ctrl+C でコピー, Cmd+V / Ctrl+V でペースト
  // INPUT / TEXTAREA 編集中は標準のクリップボード操作を妨げない
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'c') {
        e.preventDefault();
        copySelectedNodes();
      } else if (e.key === 'v') {
        e.preventDefault();
        pasteNodes();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [copySelectedNodes, pasteNodes]);

  const [contextMenu, setContextMenu] = useState<{
    targetEdgeIds: string[];
    // 対象が全て同じ種類なら表示, 混在の場合は null
    currentPathType: EdgePathType | null;
    x: number;
    y: number;
  } | null>(null);

  const CONTEXT_MENU_WIDTH = 160;
  const CONTEXT_MENU_HEIGHT = 185; // header + 4 items の概算

  const onEdgeContextMenu = useCallback(
    (e: React.MouseEvent, edge: Edge) => {
      e.preventDefault();
      const currentEdges = getEdges();
      // 右クリックした edge が選択中なら選択中の全 edge を対象にする
      const targets = edge.selected
        ? currentEdges.filter((ed) => ed.selected)
        : [edge];
      const targetEdgeIds = targets.map((ed) => ed.id);

      // 対象エッジの pathType が全て一致するか確認
      const types = targets.map(
        (ed) => (ed.data?.pathType as EdgePathType | undefined) ?? 'bezier',
      );
      const currentPathType = types.every((t) => t === types[0])
        ? types[0]
        : null;

      // 画面端からはみ出さないよう位置を補正
      const x = Math.min(e.clientX, window.innerWidth - CONTEXT_MENU_WIDTH - 8);
      const y = Math.min(
        e.clientY,
        window.innerHeight - CONTEXT_MENU_HEIGHT - 8,
      );
      setContextMenu({ targetEdgeIds, currentPathType, x, y });
    },
    [getEdges],
  );

  const setEdgePathType = useCallback(
    (targetEdgeIds: string[], pathType: EdgePathType) => {
      const targetSet = new Set(targetEdgeIds);
      setEdges((es) =>
        es.map((e) =>
          targetSet.has(e.id) ? { ...e, data: { ...e.data, pathType } } : e,
        ),
      );
      setContextMenu(null);
    },
    [setEdges],
  );

  // コンテキストメニュー外クリックで閉じる
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [contextMenu]);

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
        // biome-ignore lint/a11y/noStaticElementInteractions: context menu uses mousedown to block propagation
        <div
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            background: '#fff',
            border: '1px solid #ddd',
            borderRadius: 6,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            zIndex: 1000,
            minWidth: 160,
            padding: '4px 0',
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div
            style={{
              padding: '4px 14px 6px',
              fontSize: 11,
              color: '#888',
              borderBottom: '1px solid #eee',
              marginBottom: 4,
            }}
          >
            {contextMenu.targetEdgeIds.length === 1
              ? 'エッジの種類'
              : `${contextMenu.targetEdgeIds.length} 本のエッジを変更`}
          </div>
          {(
            [
              ['bezier', 'Bezier（曲線）'],
              ['straight', 'Straight（直線）'],
              ['step', 'Step（直角）'],
              ['smoothstep', 'Smooth Step（角丸）'],
            ] as [EdgePathType, string][]
          ).map(([type, label]) => {
            const isCurrent = contextMenu.currentPathType === type;
            return (
              <button
                key={type}
                type="button"
                onClick={() => setEdgePathType(contextMenu.targetEdgeIds, type)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  width: '100%',
                  padding: '6px 14px',
                  textAlign: 'left',
                  background: 'none',
                  border: 'none',
                  fontSize: 13,
                  fontWeight: isCurrent ? 'bold' : 'normal',
                  cursor: 'pointer',
                }}
              >
                <span style={{ width: 12, flexShrink: 0 }}>
                  {isCurrent ? '✓' : ''}
                </span>
                {label}
              </button>
            );
          })}
        </div>
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
