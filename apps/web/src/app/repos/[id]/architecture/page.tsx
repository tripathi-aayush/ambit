"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import ReactFlow, { Background, Controls, type Edge, type Node } from "reactflow";
import "reactflow/dist/style.css";
import ReactMarkdown, { type Components } from "react-markdown";
import mermaid from "mermaid";

const markdownComponents: Components = {
  h1: ({ children }) => <h1 className="mb-2 mt-4 text-lg font-semibold text-neutral-900 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-4 text-base font-semibold text-neutral-900 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-3 text-sm font-semibold text-neutral-900">{children}</h3>,
  p: ({ children }) => <p className="mb-3 text-sm leading-relaxed text-neutral-700">{children}</p>,
  ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-neutral-700">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-neutral-700">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-neutral-900">{children}</strong>,
  code: ({ children }) => <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs">{children}</code>,
  hr: () => null,
};
import {
  getArchitecture,
  getGraph,
  getRepo,
  listFiles,
  type DependencyEdge,
  type RepoFile,
  type Repository,
  type RepositoryDoc,
} from "@/lib/api";

mermaid.initialize({ startOnLoad: false, theme: "neutral" });

function DependencyGraph({ files, edges }: { files: RepoFile[]; edges: DependencyEdge[] }) {
  const { nodes, rfEdges } = useMemo(() => {
    const internalEdges = edges.filter((e) => e.target_file_id);
    const connectedIds = new Set<string>();
    internalEdges.forEach((e) => {
      connectedIds.add(e.source_file_id);
      if (e.target_file_id) connectedIds.add(e.target_file_id);
    });

    const connectedFiles = files.filter((f) => connectedIds.has(f.id));
    const columns = Math.max(1, Math.ceil(Math.sqrt(connectedFiles.length)));

    const nodes: Node[] = connectedFiles.map((f, i) => ({
      id: f.id,
      data: { label: f.path },
      position: { x: (i % columns) * 220, y: Math.floor(i / columns) * 90 },
      style: { fontSize: 11, width: 200 },
    }));

    const rfEdges: Edge[] = internalEdges.map((e, i) => ({
      id: `${e.source_file_id}-${e.target_file_id}-${i}`,
      source: e.source_file_id,
      target: e.target_file_id as string,
      animated: false,
    }));

    return { nodes, rfEdges };
  }, [files, edges]);

  if (nodes.length === 0) {
    return <p className="text-sm text-neutral-500">No internal dependency edges detected.</p>;
  }

  return (
    <div style={{ height: 420 }} className="rounded-md border border-neutral-200">
      <ReactFlow nodes={nodes} edges={rfEdges} fitView>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

function MermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const id = `mermaid-${Math.random().toString(36).slice(2)}`;
    mermaid
      .render(id, code)
      .then(({ svg }) => {
        if (!cancelled) setSvg(svg);
      })
      .catch((err) => {
        if (!cancelled) setRenderError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (renderError) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
        Failed to render diagram: {renderError}
      </div>
    );
  }
  if (!svg) return <p className="text-sm text-neutral-400">Rendering diagram…</p>;
  return <div className="overflow-x-auto rounded-md border border-neutral-200 p-4" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export default function ArchitecturePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [repo, setRepo] = useState<Repository | null>(null);
  const [doc, setDoc] = useState<RepositoryDoc | null>(null);
  const [files, setFiles] = useState<RepoFile[]>([]);
  const [edges, setEdges] = useState<DependencyEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([getRepo(id), getArchitecture(id), listFiles(id), getGraph(id)])
      .then(([repo, doc, files, edges]) => {
        setRepo(repo);
        setDoc(doc);
        setFiles(files);
        setEdges(edges);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-8">
      <header className="mb-4 border-b border-neutral-200 pb-4">
        <Link href="/" className="text-xs text-neutral-500 hover:underline">
          ← All repositories
        </Link>
        <h1 className="text-lg font-semibold">{repo?.name ?? "…"}</h1>
        <nav className="mt-2 flex gap-4 text-sm">
          <Link href={`/repos/${id}`} className="text-neutral-500 hover:underline">
            Chat
          </Link>
          <span className="font-medium text-neutral-900">Architecture</span>
        </nav>
      </header>

      {loading && <p className="text-sm text-neutral-400">Generating architecture doc — this can take a moment on first view…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {doc && (
        <div className="space-y-8 pb-8">
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            AI-generated ({doc.model}) — verify before relying on this. Cached from {new Date(doc.created_at).toLocaleString()}.
          </div>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-neutral-700">Dependency Graph</h2>
            <DependencyGraph files={files} edges={edges} />
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-neutral-700">README</h2>
            <div className="rounded-md border border-neutral-200 p-4">
              <ReactMarkdown components={markdownComponents}>{doc.readme_markdown}</ReactMarkdown>
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-neutral-700">{doc.sequence_diagram_title}</h2>
            <MermaidDiagram code={doc.sequence_diagram_mermaid} />
          </section>
        </div>
      )}
    </div>
  );
}
