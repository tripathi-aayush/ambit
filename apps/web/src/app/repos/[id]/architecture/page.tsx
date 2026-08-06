"use client";

import { use, useEffect, useMemo, useState } from "react";
import { type Edge, type Node } from "reactflow";
import ReactMarkdown from "react-markdown";
import mermaid from "mermaid";
import { Package, Sparkles } from "lucide-react";
import { RepoNav } from "@/components/RepoNav";
import { markdownComponents } from "@/components/markdownComponents";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { SkeletonText } from "@/components/ui/Skeleton";
import { ActionGraph } from "@/components/graph/ActionGraph";
import { layoutWithDagre } from "@/components/graph/layout";
import { externalDependencies } from "@/lib/repoStats";
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

mermaid.initialize({
  startOnLoad: false,
  theme: "base",
  themeVariables: {
    primaryColor: "#eef2ff",
    primaryTextColor: "#312e81",
    primaryBorderColor: "#4f46e5",
    lineColor: "#a3a3a3",
    fontSize: "12px",
  },
});

function DependencyGraph({ files, edges }: { files: RepoFile[]; edges: DependencyEdge[] }) {
  const { nodes, edges: rfEdges } = useMemo(() => {
    const internalEdges = edges.filter((e) => e.target_file_id);
    const connectedIds = new Set<string>();
    internalEdges.forEach((e) => {
      connectedIds.add(e.source_file_id);
      if (e.target_file_id) connectedIds.add(e.target_file_id);
    });

    const connectedFiles = files.filter((f) => connectedIds.has(f.id));

    const rawNodes: Node[] = connectedFiles.map((f) => ({
      id: f.id,
      data: { label: f.path },
      position: { x: 0, y: 0 },
      style: {
        fontSize: 11,
        width: 200,
        background: "#ffffff",
        border: "1px solid #d4d4d4",
        borderRadius: 6,
        padding: 6,
      },
    }));

    const rawEdges: Edge[] = internalEdges.map((e, i) => ({
      id: `${e.source_file_id}-${e.target_file_id}-${i}`,
      source: e.source_file_id,
      target: e.target_file_id as string,
      type: "smoothstep",
      style: { stroke: "#c7c7c7" },
    }));

    return layoutWithDagre(rawNodes, rawEdges, "LR");
  }, [files, edges]);

  if (nodes.length === 0) {
    return <p className="text-sm text-neutral-500 dark:text-neutral-400">No internal dependency edges detected.</p>;
  }

  return <ActionGraph nodes={nodes} edges={rfEdges} height={380} />;
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
      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400">
        Failed to render diagram: {renderError}
      </div>
    );
  }
  if (!svg) return <p className="text-sm text-neutral-400 dark:text-neutral-500">Rendering diagram…</p>;
  return (
    <div
      style={{ height: 380 }}
      className="overflow-auto rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-800"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export default function ArchitecturePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [repo, setRepo] = useState<Repository | null>(null);
  const [doc, setDoc] = useState<RepositoryDoc | null>(null);
  const [files, setFiles] = useState<RepoFile[]>([]);
  const [edges, setEdges] = useState<DependencyEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const externalDeps = useMemo(() => externalDependencies(edges), [edges]);

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
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-8">
      <PageHeader backHref="/repos" title={repo?.name ?? "…"} tabs={<RepoNav repoId={id} active="architecture" />} />

      {loading && (
        <div className="space-y-6">
          <p className="text-sm text-neutral-400 dark:text-neutral-500">Generating architecture doc — this can take a moment on first view…</p>
          <SkeletonText lines={4} />
        </div>
      )}
      {error && <ErrorMessage>{error}</ErrorMessage>}

      {doc && (
        <div className="space-y-8 pb-8">
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-400">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            <span>
              AI-generated ({doc.model}) — verify before relying on this. Cached from{" "}
              {new Date(doc.created_at).toLocaleString()}.
            </span>
          </div>

          <div className="grid gap-8 lg:grid-cols-2">
            <section>
              <h2 className="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">Dependency Graph</h2>
              <DependencyGraph files={files} edges={edges} />
            </section>

            <section>
              <h2 className="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">{doc.sequence_diagram_title}</h2>
              <MermaidDiagram code={doc.sequence_diagram_mermaid} />
            </section>
          </div>

          {externalDeps.length > 0 && (
            <section>
              <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                <Package className="h-3.5 w-3.5" strokeWidth={2} />
                External dependencies
                <span className="font-normal text-neutral-400 dark:text-neutral-500">({externalDeps.length})</span>
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {externalDeps.map((dep) => (
                  <span
                    key={dep}
                    className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 font-mono text-xs text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300"
                  >
                    {dep}
                  </span>
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">README</h2>
            <div className="rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
              <ReactMarkdown components={markdownComponents}>{doc.readme_markdown}</ReactMarkdown>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
