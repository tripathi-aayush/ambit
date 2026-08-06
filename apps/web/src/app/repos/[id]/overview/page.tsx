"use client";

import { use, useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileCode2, Languages, Package, Route, Users } from "lucide-react";
import { RepoNav } from "@/components/RepoNav";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { BarChart } from "@/components/ui/BarChart";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { SkeletonText } from "@/components/ui/Skeleton";
import { LANGUAGE_COLORS, detectedRoutes, externalDependencies, languageBreakdown, topContributors } from "@/lib/repoStats";
import { timeAgo } from "@/lib/time";
import { getGraph, getRepo, listFiles, type DependencyEdge, type Repository, type RepoFile } from "@/lib/api";

const METHOD_COLORS: Record<string, string> = {
  GET: "text-blue-600 dark:text-blue-400",
  POST: "text-green-600 dark:text-green-400",
  PUT: "text-amber-600 dark:text-amber-400",
  PATCH: "text-amber-600 dark:text-amber-400",
  DELETE: "text-red-600 dark:text-red-400",
};

export default function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [repo, setRepo] = useState<Repository | null>(null);
  const [files, setFiles] = useState<RepoFile[]>([]);
  const [edges, setEdges] = useState<DependencyEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([getRepo(id), listFiles(id), getGraph(id)])
      .then(([repo, files, edges]) => {
        setRepo(repo);
        setFiles(files);
        setEdges(edges);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [id]);

  const languages = useMemo(() => languageBreakdown(files), [files]);
  const externalDeps = useMemo(() => externalDependencies(edges), [edges]);
  const contributors = useMemo(() => topContributors(files), [files]);
  const routes = useMemo(() => detectedRoutes(files), [files]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-8">
      <PageHeader backHref="/repos" title={repo?.name ?? "…"} tabs={<RepoNav repoId={id} active="overview" />} />

      {loading && <SkeletonText lines={6} />}
      {error && <ErrorMessage>{error}</ErrorMessage>}

      {repo && (
        <div className="space-y-8 pb-8">
          {repo.error && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              <span>
                <span className="font-medium">Ingestion completed with issues:</span> {repo.error}
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Files" value={String(files.length)} icon={FileCode2} />
            <StatCard label="Languages" value={String(Object.keys(languages).length)} icon={Languages} />
            <StatCard label="External deps" value={String(externalDeps.length)} icon={Package} />
            <StatCard label="API routes" value={String(routes.length)} icon={Route} />
          </div>

          <div className="grid gap-8 lg:grid-cols-2">
            <Card>
              <BarChart title="Languages" data={languages} colors={LANGUAGE_COLORS} />
            </Card>

            <Card>
              <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                <Users className="h-3.5 w-3.5" strokeWidth={2} />
                Top contributors
              </h2>
              {contributors.length === 0 ? (
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  No commit history attributed yet.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {contributors.map((c) => (
                    <li key={c.email} className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate text-neutral-700 dark:text-neutral-300" title={c.email}>
                        {c.name}
                      </span>
                      <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">
                        {c.filesTouched} file{c.filesTouched === 1 ? "" : "s"}
                        {timeAgo(c.lastCommitAt) ? ` · ${timeAgo(c.lastCommitAt)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <section>
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
              <Route className="h-3.5 w-3.5" strokeWidth={2} />
              API surface
            </h2>
            {routes.length === 0 ? (
              <EmptyState icon={Route} title="No routes detected" description="Orion didn't find any HTTP route definitions in the parsed source." />
            ) : (
              <Card padded={false} className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {routes.slice(0, 25).map((r, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2 text-xs">
                    <span className={`w-14 shrink-0 font-mono font-semibold ${METHOD_COLORS[r.method] ?? "text-neutral-500"}`}>
                      {r.method}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-neutral-800 dark:text-neutral-200">{r.path}</span>
                    <span className="shrink-0 truncate text-neutral-400 dark:text-neutral-500">
                      {r.filePath}:{r.line}
                    </span>
                  </div>
                ))}
                {routes.length > 25 && (
                  <p className="px-4 py-2 text-xs text-neutral-400 dark:text-neutral-500">+{routes.length - 25} more</p>
                )}
              </Card>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
