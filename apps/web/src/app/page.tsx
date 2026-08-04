"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createRepo, listRepos, type Repository } from "@/lib/api";

const STATUS_STYLES: Record<Repository["status"], string> = {
  pending: "bg-neutral-200 text-neutral-700",
  processing: "bg-amber-100 text-amber-800",
  ready: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
};

export default function HomePage() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [cloneUrl, setCloneUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      setRepos(await listRepos());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const interval = setInterval(() => {
      refresh();
    }, 4000);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; refresh() awaits before setting state
    refresh();
    return () => clearInterval(interval);
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

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Ambit</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Ingest a repository, then chat with it once it&apos;s ready.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={cloneUrl}
          onChange={(e) => setCloneUrl(e.target.value)}
          placeholder="https://github.com/owner/repo.git"
          className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? "Starting…" : "Ingest"}
        </button>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <section className="flex flex-col gap-2">
        {loading && <p className="text-sm text-neutral-500">Loading…</p>}
        {!loading && repos.length === 0 && (
          <p className="text-sm text-neutral-500">No repositories yet — ingest one above.</p>
        )}
        {repos.map((repo) => (
          <Link
            key={repo.id}
            href={repo.status === "ready" ? `/repos/${repo.id}` : "#"}
            className={`flex items-center justify-between rounded-md border border-neutral-200 px-4 py-3 ${
              repo.status === "ready" ? "hover:border-neutral-400" : "cursor-default opacity-80"
            }`}
          >
            <div>
              <p className="text-sm font-medium">{repo.name}</p>
              <p className="text-xs text-neutral-500">{repo.clone_url}</p>
              {repo.frameworks.length > 0 && (
                <p className="mt-1 text-xs text-neutral-400">{repo.frameworks.join(", ")}</p>
              )}
            </div>
            <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLES[repo.status]}`}>
              {repo.status}
            </span>
          </Link>
        ))}
      </section>
    </div>
  );
}
