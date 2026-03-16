import { useCallback, useEffect, useRef } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Panel,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type OnConnect,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { GraphFile, GraphNode, GraphEdge } from '@conversensus/shared'

function toFlowNodes(nodes: GraphNode[]): Node[] {
  return nodes.map((n) => ({
    id: n.id,
    position: n.position,
    data: { label: n.content },
  }))
}

function toFlowEdges(edges: GraphEdge[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
  }))
}

function fromFlowNodes(nodes: Node[]): GraphNode[] {
  return nodes.map((n) => ({
    id: n.id,
    content: String(n.data.label ?? ''),
    position: n.position,
  }))
}

function fromFlowEdges(edges: Edge[]): GraphEdge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: typeof e.label === 'string' ? e.label : undefined,
  }))
}

type Props = {
  file: GraphFile
  onChange: (file: GraphFile) => void
}

function GraphEditorInner({ file, onChange }: Props) {
  const { screenToFlowPosition } = useReactFlow()
  const [nodes, setNodes, onNodesChange] = useNodesState(
    toFlowNodes(file.sheet.nodes),
  )
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    toFlowEdges(file.sheet.edges),
  )
  // 初回マウント時の onChange 抑制
  const mounted = useRef(false)

  // file が切り替わったら React Flow の state をリセット
  useEffect(() => {
    mounted.current = false
    setNodes(toFlowNodes(file.sheet.nodes))
    setEdges(toFlowEdges(file.sheet.edges))
  }, [file.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // nodes/edges が変わったら親に通知
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    onChange({
      ...file,
      sheet: {
        ...file.sheet,
        nodes: fromFlowNodes(nodes),
        edges: fromFlowEdges(edges),
      },
    })
  }, [nodes, edges]) // eslint-disable-line react-hooks/exhaustive-deps

  const onConnect: OnConnect = useCallback(
    (connection) => setEdges((es) => addEdge(connection, es)),
    [setEdges],
  )

  const addNode = useCallback(
    (position?: { x: number; y: number }) => {
      const id = crypto.randomUUID()
      const pos = position ?? { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 }
      setNodes((ns) => [
        ...ns,
        { id, position: pos, data: { label: '新しいノード' } },
      ])
    },
    [setNodes],
  )

  const onPaneDoubleClick = useCallback(
    (e: MouseEvent) => {
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      addNode(pos)
    },
    [screenToFlowPosition, addNode],
  )

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
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
  )
}

export function GraphEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <GraphEditorInner {...props} />
    </ReactFlowProvider>
  )
}
