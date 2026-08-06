"use client";

import ReactFlow, { Background, Controls, type Edge, type Node } from "reactflow";
import "reactflow/dist/style.css";

export function ActionGraph({ nodes, edges, height = 420 }: { nodes: Node[]; edges: Edge[]; height?: number }) {
  return (
    <div style={{ height }} className="rounded-md border border-neutral-200 bg-neutral-50/30 dark:border-neutral-800 dark:bg-neutral-900/40">
      <ReactFlow nodes={nodes} edges={edges} fitView proOptions={{ hideAttribution: true }}>
        <Background gap={16} color="#e5e5e5" />
        <Controls position="top-right" showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
