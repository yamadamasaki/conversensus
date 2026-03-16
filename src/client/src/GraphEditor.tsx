import { useCallback, useEffect } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
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

export function GraphEditor({ file, onChange }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState(
    toFlowNodes(file.sheet.nodes),
  )
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    toFlowEdges(file.sheet.edges),
  )

  // file が切り替わったら React Flow の state をリセット
  useEffect(() => {
    setNodes(toFlowNodes(file.sheet.nodes))
    setEdges(toFlowEdges(file.sheet.edges))
  }, [file.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // nodes/edges が変わったら親に通知 (debounce は App 側で行う)
  useEffect(() => {
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

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  )
}
