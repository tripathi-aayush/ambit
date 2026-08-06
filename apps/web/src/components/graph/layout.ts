import dagre from "dagre";
import { type Edge, type Node } from "reactflow";

const DEFAULT_WIDTH = 200;
const DEFAULT_HEIGHT = 56;

// Both the dependency graph (Architecture) and the action DAG (Tasks)
// previously placed nodes on a naive sqrt-grid with no regard for edges,
// which visibly tangles past a handful of nodes. dagre gives both a real
// hierarchical layout for the cost of one shared helper.
export function layoutWithDagre(nodes: Node[], edges: Edge[], direction: "TB" | "LR" = "TB") {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep: 32, ranksep: 56 });

  nodes.forEach((node) => {
    const width = (node.style?.width as number) ?? DEFAULT_WIDTH;
    const height = (node.style?.height as number) ?? DEFAULT_HEIGHT;
    g.setNode(node.id, { width, height });
  });
  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const { x, y } = g.node(node.id);
    const width = (node.style?.width as number) ?? DEFAULT_WIDTH;
    const height = (node.style?.height as number) ?? DEFAULT_HEIGHT;
    return { ...node, position: { x: x - width / 2, y: y - height / 2 } };
  });

  return { nodes: layoutedNodes, edges };
}
