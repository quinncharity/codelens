import { useCallback, useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeMouseHandler,
  useNodesState,
  useEdgesState,
  Position,
} from '@xyflow/react'
import dagre from '@dagrejs/dagre'
import type { ServiceModule } from '@codelens/proto-ts'
import '@xyflow/react/dist/style.css'

const NODE_WIDTH = 200
const NODE_HEIGHT = 60

function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 80 })

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target)
  }

  dagre.layout(g)

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id)
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    }
  })

  return { nodes: layoutedNodes, edges }
}

interface ArchitectureDiagramProps {
  services: ServiceModule[]
  onNodeClick?: (serviceName: string) => void
}

export function ArchitectureDiagram({
  services,
  onNodeClick,
}: ArchitectureDiagramProps) {
  const { initialNodes, initialEdges } = useMemo(() => {
    const nodes: Node[] = services.map((svc) => ({
      id: svc.name,
      data: {
        label: (
          <div className="architecture-node">
            <div className="architecture-node-name">{svc.name}</div>
            <div className="architecture-node-type">
              {(svc.moduleType || 'module').toUpperCase()}
            </div>
          </div>
        ),
      },
      position: { x: 0, y: 0 },
      type: 'default',
    }))

    const serviceNames = new Set(services.map((s) => s.name))
    const edges: Edge[] = []
    for (const svc of services) {
      for (const dep of svc.dependsOn ?? []) {
        if (serviceNames.has(dep)) {
          edges.push({
            id: `${svc.name}->${dep}`,
            source: svc.name,
            target: dep,
            animated: true,
            style: { stroke: 'var(--c2)' },
          })
        }
      }
    }

    const layouted = getLayoutedElements(nodes, edges)
    return { initialNodes: layouted.nodes, initialEdges: layouted.edges }
  }, [services])

  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [edges, , onEdgesChange] = useEdgesState(initialEdges)

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      onNodeClick?.(node.id)
    },
    [onNodeClick],
  )

  if (services.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No service modules detected.
      </div>
    )
  }

  return (
    <div className="architecture-diagram-container">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        fitView
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
      >
        <Background gap={16} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
