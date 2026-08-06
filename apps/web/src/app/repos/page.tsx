"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, FolderGit2, GitBranch } from "lucide-react";
import { createRepo, listRepos, type Repository } from "@/lib/api";
import { RepoStatusPill } from "@/components/badges";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { PageHeader } from "@/components/ui/PageHeader";
import { SkeletonRow } from "@/components/ui/Skeleton";

const ACTIVE_STATUSES = new Set<Repository["status"]>(["pending", "processing"]);

function IngestForm({
  cloneUrl,
  setCloneUrl,
  submitting,
  onSubmit,
  compact = false,
}: {
  cloneUrl: string;
  setCloneUrl: (v: string) => void;
  submitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
  compact?: boolean;
}) {
  return (
    <form onSubmit={onSubmit} className={`flex gap-2 ${compact ? "" : "w-full max-w-md"}`}>
      <input
        type="text"
        value={cloneUrl}
        onChange={(e) => setCloneUrl(e.target.value)}
        placeholder="https://github.com/owner/repo.git"
        className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent dark:border-neutral-700 dark:bg-neutral-900"
      />
      <Button type="submit" loading={submitting}>
        {submitting ? "Starting…" : "Ingest"}
      </Button>
    </form>
  );
}

export default function RepositoriesPage() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [cloneUrl, setCloneUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = async () => {
    try {
      const next = await listRepos();
      setRepos(next);

      const stillActive = next.some((r) => ACTIVE_STATUSES.has(r.status));
      if (stillActive && intervalRef.current === null) {
        intervalRef.current = setInterval(refresh, 4000);
      } else if (!stillActive && intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; refresh() awaits before setting state
    refresh();
    return () => {
      if (intervalRef.current !== null) clearInterval(intervalRef.current);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cloneUrl.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createRepo(cloneUrl.trim());
      setCloneUrl("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const hasRepos = repos.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      <PageHeader
        title="Repositories"
        description="Every repository Orion has ingested. Add another below, or open one to chat, generate plans, and review changes."
      />

      {hasRepos && (
        <IngestForm cloneUrl={cloneUrl} setCloneUrl={setCloneUrl} submitting={submitting} onSubmit={handleSubmit} compact />
      )}

      {error && <ErrorMessage>{error}</ErrorMessage>}

      <section className="flex flex-col gap-2">
        {loading && (
          <div className="space-y-2">
            <SkeletonRow />
            <SkeletonRow />
          </div>
        )}

        {!loading && !hasRepos && (
          <EmptyState
            icon={FolderGit2}
            title="No repositories yet"
            description="Ingest a GitHub repository to start chatting with it, generating plans, and governing every change Orion makes."
            action={
              <div className="mt-2">
                <IngestForm cloneUrl={cloneUrl} setCloneUrl={setCloneUrl} submitting={submitting} onSubmit={handleSubmit} />
              </div>
            }
          />
        )}

        {!loading &&
          repos.map((repo) => (
            <Link
              key={repo.id}
              href={repo.status === "ready" ? `/repos/${repo.id}/overview` : "#"}
              className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-950"
            >
              <Card hoverable={repo.status === "ready"} className={`flex items-center justify-between ${repo.status !== "ready" ? "opacity-80" : ""}`}>
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500">
                    <GitBranch className="h-4 w-4" strokeWidth={2} />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{repo.name}</p>
                    <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{repo.clone_url}</p>
                    <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                      {repo.frameworks.length > 0 && `${repo.frameworks.join(", ")} · `}
                      Added {new Date(repo.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {repo.status === "ready" && repo.error && (
                    <span
                      title={repo.error}
                      className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                    >
                      <AlertTriangle className="h-3 w-3" strokeWidth={2} />
                      degraded
                    </span>
                  )}
                  {repo.status !== "ready" && <RepoStatusPill status={repo.status} />}
                </div>
              </Card>
            </Link>
          ))}
      </section>
    </div>
  );
}
