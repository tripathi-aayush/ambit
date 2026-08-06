import type { DependencyEdge, RepoFile } from "@/lib/api";

// Client-side aggregation over data the backend already returns per-file
// (GET /repos/{id}/files nests symbols/summary/ownership) but that nothing
// in the app previously read. No new endpoints -- just not discarding what
// we already fetched.

export function languageBreakdown(files: RepoFile[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of files) {
    const lang = f.language ?? "other";
    counts[lang] = (counts[lang] ?? 0) + 1;
  }
  return counts;
}

export function primaryLanguage(files: RepoFile[]): string | null {
  const counts = languageBreakdown(files);
  const entries = Object.entries(counts);
  if (entries.length === 0) return null;
  return entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
}

export const LANGUAGE_COLORS: Record<string, string> = {
  python: "bg-blue-400",
  javascript: "bg-amber-400",
  typescript: "bg-blue-500",
  go: "bg-cyan-400",
  rust: "bg-orange-500",
  java: "bg-red-400",
  ruby: "bg-red-500",
  markdown: "bg-neutral-400",
  docs: "bg-neutral-400",
  json: "bg-neutral-400",
  yaml: "bg-neutral-400",
  toml: "bg-neutral-400",
  html: "bg-orange-400",
  css: "bg-indigo-400",
  sql: "bg-teal-400",
  other: "bg-neutral-300",
};

export function externalDependencies(edges: DependencyEdge[]): string[] {
  const names = new Set<string>();
  for (const e of edges) {
    if (e.target_external_name) names.add(e.target_external_name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export interface ContributorStat {
  name: string;
  email: string;
  filesTouched: number;
  lastCommitAt: string | null;
}

// Ranked by distinct files touched, not summed commit_count -- FileOwnership
// is one row per (file, author), so summing commit_count across files would
// double-count a single commit that happened to touch several files. Files
// touched is the honest number this data actually supports.
export function topContributors(files: RepoFile[], limit = 5): ContributorStat[] {
  const byEmail = new Map<string, ContributorStat>();
  for (const f of files) {
    for (const o of f.ownership) {
      const existing = byEmail.get(o.author_email);
      if (existing) {
        existing.filesTouched += 1;
        if (o.last_commit_at && (!existing.lastCommitAt || o.last_commit_at > existing.lastCommitAt)) {
          existing.lastCommitAt = o.last_commit_at;
        }
      } else {
        byEmail.set(o.author_email, {
          name: o.author_name,
          email: o.author_email,
          filesTouched: 1,
          lastCommitAt: o.last_commit_at,
        });
      }
    }
  }
  return [...byEmail.values()].sort((a, b) => b.filesTouched - a.filesTouched).slice(0, limit);
}

export interface RouteStat {
  method: string;
  path: string;
  filePath: string;
  line: number;
}

// Symbol.name for symbol_type "route" is already "METHOD /path" (see
// ingestion/parser.py) -- just splitting it back apart for display.
export function detectedRoutes(files: RepoFile[]): RouteStat[] {
  const routes: RouteStat[] = [];
  for (const f of files) {
    for (const s of f.symbols) {
      if (s.symbol_type === "route") {
        const [method, ...rest] = s.name.split(" ");
        routes.push({ method, path: rest.join(" "), filePath: f.path, line: s.start_line });
      }
    }
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path));
}
