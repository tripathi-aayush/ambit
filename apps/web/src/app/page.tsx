"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FolderGit2, ShieldCheck } from "lucide-react";
import {
  createRepo,
  decideApproval,
  getActionEvents,
  listAllActions,
  listFiles,
  listPlans,
  listRepos,
  type Action,
  type ActionEvent,
  type Plan,
  type Repository,
} from "@/lib/api";
import { RepoStatusPill } from "@/components/badges";
import { DecisionCard, ResolvedCard, type RepoRef } from "@/components/ApprovalCards";
import { actionTypeMeta } from "@/components/actionTypeIcons";
import { timeAgo } from "@/lib/time";
import { executionOutcome } from "@/lib/eventDetail";
import { notifyPendingChanged } from "@/lib/pendingSignal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { SkeletonText } from "@/components/ui/Skeleton";
import { DataTable, DataTd, DataTh } from "@/components/ui/DataTable";

const RISK_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };
const REPO_TABLE_LIMIT = 6;
const APPROVER = "web-ui-user";
const TERMINAL_STATUSES = new Set(["completed", "failed", "denied"]);

const INPUT_CLASSES =
  "flex-1 rounded-lg border border-border bg-surface px-4 py-3 text-base text-foreground placeholder:text-foreground-dim/60 outline-none focus:border-accent";

// Deliberately the only ingest surface on Home -- one dedicated,
// high-visibility panel rather than a slim bar duplicated near the top,
// so there's exactly one obvious place to paste a URL.
function AddRepositoryCard({
  cloneUrl,
  setCloneUrl,
  submitting,
  onSubmit,
}: {
  cloneUrl: string;
  setCloneUrl: (v: string) => void;
  submitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <Card label="ADD REPOSITORY" id="add-repository">
      <p className="text-sm text-foreground-dim">
        Orion clones and indexes the repository, then it&apos;s ready to chat with, plan changes against, and govern.
      </p>
      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          value={cloneUrl}
          onChange={(e) => setCloneUrl(e.target.value)}
          placeholder="https://github.com/owner/repo.git"
          className={INPUT_CLASSES}
        />
        <Button type="submit" size="lg" loading={submitting}>
          {submitting ? "Adding…" : "Add Repository"}
        </Button>
      </form>
    </Card>
  );
}

// The primary object when nothing needs a human: a specific, concrete
// receipt for the last real thing that happened -- not a claim ("all
// clear") but evidence.
function ProofCard({
  action,
  repoRef,
  events,
  repoCount,
  executingCount,
}: {
  action: Action;
  repoRef: RepoRef | undefined;
  events: ActionEvent[] | null;
  repoCount: number;
  executingCount: number;
}) {
  const { label } = actionTypeMeta(action.action_type);
  const outcome = events ? executionOutcome(events) : null;

  return (
    <Card tone="accent" label="Last known good">
      <div className="flex items-start gap-3.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <ShieldCheck className="h-5 w-5" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-extrabold text-foreground">Nothing waiting on you</p>
          <p className="mt-1 text-sm text-foreground-dim">
            Last: {repoRef && <span className="text-foreground">{repoRef.repoName}</span>}
            {repoRef && " — "}
            {label} <span className="font-mono">{action.target}</span>, {timeAgo(action.created_at)}
            {outcome?.commitSha && (
              <>
                {" · commit "}
                <span className="font-mono">{outcome.commitSha.slice(0, 7)}</span>
              </>
            )}
            {outcome?.prUrl && (
              <>
                {" · "}
                <a href={outcome.prUrl} target="_blank" rel="noreferrer" className="text-accent underline">
                  PR opened
                </a>
              </>
            )}
            {action.status === "failed" && " · failed"}
            {action.status === "denied" && " · denied"}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-foreground-dim">
            <span>
              {repoCount} repositor{repoCount === 1 ? "y" : "ies"} monitored
            </span>
            {executingCount > 0 && (
              <span className="flex items-center gap-1.5 text-risk-medium">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-risk-medium" />
                {executingCount} running now
              </span>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function FailedReposCard({ repos }: { repos: Repository[] }) {
  return (
    <Card tone="danger" label="Ingestion failed">
      <div className="flex items-start gap-3.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-risk-high/10 text-risk-high">
          <AlertTriangle className="h-5 w-5" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-extrabold text-foreground">
            {repos.length} repositor{repos.length === 1 ? "y" : "ies"} failed to ingest
          </p>
          <div className="mt-2 space-y-1">
            {repos.slice(0, 3).map((r) => (
              <p key={r.id} className="text-sm text-foreground-dim">
                <span className="text-foreground">{r.name}</span>
                {r.error && <span> — {r.error}</span>}
              </p>
            ))}
          </div>
          <Link href="/repos" className="mt-2 inline-block text-xs text-accent hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent">
            View repositories →
          </Link>
        </div>
      </div>
    </Card>
  );
}

export default function HomePage() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [allActions, setAllActions] = useState<Action[]>([]);
  const [planRepoMap, setPlanRepoMap] = useState<Map<string, RepoRef>>(new Map());
  const [latestActivityByRepo, setLatestActivityByRepo] = useState<Map<string, string>>(new Map());
  const [summaryPctByRepo, setSummaryPctByRepo] = useState<Map<string, number>>(new Map());
  const [cloneUrl, setCloneUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState("");

  const [primaryEvents, setPrimaryEvents] = useState<ActionEvent[] | null>(null);
  const [primaryEventsLoading, setPrimaryEventsLoading] = useState(false);
  const [decidingChoice, setDecidingChoice] = useState<"approved" | "denied" | null>(null);
  const [justResolved, setJustResolved] = useState<{ action: Action; decision: "approved" | "denied"; repoRef: RepoRef | undefined } | null>(
    null
  );

  useEffect(() => {
    const update = () => setClock(new Date().toLocaleTimeString("en-US", { hour12: false }));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  const refreshCore = async () => {
    const [repos, actions] = await Promise.all([listRepos(), listAllActions()]);
    setRepos(repos);
    setAllActions(actions);

    // Action has no repository_id column -- only reachable via
    // plan_id -> Plan.repository_id -- so this resolves "which repo"
    // for every action shown below with one batch of per-repo plan
    // fetches (bounded by repo count) instead of one fetch per action
    // (bounded by activity volume, which grows unboundedly).
    const plansPerRepo = await Promise.all(repos.map((r) => listPlans(r.id).catch(() => [] as Plan[])));
    const planMap = new Map<string, RepoRef>();
    const latestMap = new Map<string, string>();
    repos.forEach((repo, i) => {
      const plans = plansPerRepo[i];
      for (const plan of plans) planMap.set(plan.id, { repoId: repo.id, repoName: repo.name });
      if (plans.length > 0) {
        const latest = plans.reduce((a, b) => (a.created_at > b.created_at ? a : b));
        latestMap.set(repo.id, latest.created_at);
      }
    });
    setPlanRepoMap(planMap);
    setLatestActivityByRepo(latestMap);
  };

  useEffect(() => {
    setLoading(true);
    setError(null);
    refreshCore()
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pendingActions = useMemo(
    () =>
      allActions
        .filter((a) => a.status === "pending")
        .sort((a, b) => {
          const riskDiff = (RISK_RANK[b.risk_level ?? ""] ?? 0) - (RISK_RANK[a.risk_level ?? ""] ?? 0);
          return riskDiff !== 0 ? riskDiff : b.created_at.localeCompare(a.created_at);
        }),
    [allActions]
  );

  const executingCount = useMemo(() => allActions.filter((a) => a.status === "executing").length, [allActions]);

  // The calm-state receipt has to be a real outcome, not just the most
  // recent row -- an "approved" action whose plan later failed upstream
  // (e.g. a denied dependency blocked it before it ever ran) never
  // actually happened, and presenting it as "the last thing that
  // happened" would be exactly the false assurance this page exists to
  // avoid. Only completed/failed/denied are real, citable outcomes.
  const mostRecentTerminal = useMemo(
    () =>
      [...allActions]
        .filter((a) => TERMINAL_STATUSES.has(a.status))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null,
    [allActions]
  );

  const failedRepos = useMemo(() => repos.filter((r) => r.status === "failed"), [repos]);

  const sortedRepos = useMemo(
    () =>
      [...repos].sort((a, b) => {
        const aTime = latestActivityByRepo.get(a.id) ?? a.created_at;
        const bTime = latestActivityByRepo.get(b.id) ?? b.created_at;
        return bTime.localeCompare(aTime);
      }),
    [repos, latestActivityByRepo]
  );

  const pendingCountByRepo = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of pendingActions) {
      const repoRef = a.plan_id ? planRepoMap.get(a.plan_id) : undefined;
      if (!repoRef) continue;
      map.set(repoRef.repoId, (map.get(repoRef.repoId) ?? 0) + 1);
    }
    return map;
  }, [pendingActions, planRepoMap]);

  const topPending = justResolved ? null : pendingActions[0] ?? null;
  const mostRecent = justResolved ? null : mostRecentTerminal;
  const primaryAction = topPending ?? mostRecent;

  useEffect(() => {
    if (!primaryAction) {
      setPrimaryEvents(null);
      return;
    }
    setPrimaryEventsLoading(true);
    getActionEvents(primaryAction.id)
      .then(setPrimaryEvents)
      .catch(() => setPrimaryEvents([]))
      .finally(() => setPrimaryEventsLoading(false));
  }, [primaryAction?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Summarized" % -- the share of indexed files that have a generated
  // summary -- fetched only for the small, capped set of repos actually
  // shown in the table (not every repo ever ingested), so this stays
  // bounded regardless of history depth. Runs after the main load so the
  // page's critical content never waits on it.
  const tableRepoIds = sortedRepos
    .filter((r) => r.status === "ready")
    .slice(0, REPO_TABLE_LIMIT)
    .map((r) => r.id)
    .join(",");

  useEffect(() => {
    if (!tableRepoIds) return;
    const ids = tableRepoIds.split(",");
    Promise.all(
      ids.map((id) =>
        listFiles(id)
          .then((files): [string, number] => [id, files.length === 0 ? 0 : files.filter((f) => f.summary !== null).length / files.length])
          .catch(() => null)
      )
    ).then((results) => {
      const map = new Map<string, number>();
      for (const r of results) if (r) map.set(r[0], r[1]);
      setSummaryPctByRepo(map);
    });
  }, [tableRepoIds]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cloneUrl.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createRepo(cloneUrl.trim());
      setCloneUrl("");
      const next = await listRepos();
      setRepos(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecide = async (action: Action, decision: "approved" | "denied") => {
    const repoRef = action.plan_id ? planRepoMap.get(action.plan_id) : undefined;
    setDecidingChoice(decision);
    setError(null);
    try {
      await decideApproval(action.id, decision, APPROVER);
      notifyPendingChanged();
      await refreshCore();
      setJustResolved({ action, decision, repoRef });
      setTimeout(() => setJustResolved(null), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDecidingChoice(null);
    }
  };

  const hasRepos = repos.length > 0;

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-8">
        <div className="pb-6 text-center">
          <h1 className="font-display text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl">ORION</h1>
          <p className="mt-3 text-sm text-foreground-dim">Ship software, not surprises.</p>
        </div>

        <div className="mb-6 grid grid-cols-2 divide-x divide-border overflow-hidden rounded-lg border border-border sm:grid-cols-4">
          <div className="px-4 py-2.5">
            <p className="font-mono text-xs uppercase tracking-wide text-foreground-dim">Project root</p>
            <p className="mt-0.5 truncate text-sm text-foreground">/orion/control-room</p>
          </div>
          <div className="px-4 py-2.5">
            <p className="font-mono text-xs uppercase tracking-wide text-foreground-dim">Sandbox</p>
            <p className="mt-0.5 text-sm text-foreground">Isolated</p>
          </div>
          <div className="px-4 py-2.5">
            <p className="font-mono text-xs uppercase tracking-wide text-foreground-dim">Repos</p>
            <p className="mt-0.5 text-sm text-foreground">{repos.length}</p>
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div>
              <p className="font-mono text-xs uppercase tracking-wide text-foreground-dim">Status</p>
              <p className="mt-0.5 font-mono text-sm tabular-nums text-foreground">{clock}</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-risk-low/10 px-2 py-0.5 font-mono text-xs uppercase tracking-wide text-risk-low">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-risk-low" />
              Live
            </span>
          </div>
        </div>

        {loading && <SkeletonText lines={6} />}
        {error && <ErrorMessage>{error}</ErrorMessage>}

        {!loading && !hasRepos && (
          <EmptyState
            icon={FolderGit2}
            title="Welcome to Orion"
            description="Ingest a GitHub repository to start chatting with it, generating plans, and governing every change Orion makes."
            action={
              <form onSubmit={handleSubmit} className="mt-2 flex flex-col gap-3 sm:flex-row">
                <input
                  type="text"
                  value={cloneUrl}
                  onChange={(e) => setCloneUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo.git"
                  className={INPUT_CLASSES}
                />
                <Button type="submit" size="lg" loading={submitting}>
                  {submitting ? "Adding…" : "Add Repository"}
                </Button>
              </form>
            }
          />
        )}

        {!loading && hasRepos && (
          <div className="space-y-8">
            {/* The primary object: exactly one of decision, resolved fact,
                proof, or a failed-ingestion notice -- never a summary. */}
            {justResolved ? (
              <ResolvedCard action={justResolved.action} decision={justResolved.decision} repoRef={justResolved.repoRef} approver={APPROVER} />
            ) : topPending ? (
              <DecisionCard
                action={topPending}
                repoRef={topPending.plan_id ? planRepoMap.get(topPending.plan_id) : undefined}
                events={primaryEvents}
                eventsLoading={primaryEventsLoading}
                deciding={decidingChoice}
                onDecide={(decision) => handleDecide(topPending, decision)}
              />
            ) : failedRepos.length > 0 ? (
              <FailedReposCard repos={failedRepos} />
            ) : mostRecent ? (
              <ProofCard
                action={mostRecent}
                repoRef={mostRecent.plan_id ? planRepoMap.get(mostRecent.plan_id) : undefined}
                events={primaryEvents}
                repoCount={repos.length}
                executingCount={executingCount}
              />
            ) : (
              <Card tone="accent" label="System status">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                    <ShieldCheck className="h-5 w-5" strokeWidth={2} />
                  </div>
                  <div>
                    <p className="font-display text-lg font-extrabold text-foreground">Indexed and ready — nothing has run yet</p>
                    <p className="mt-0.5 text-sm text-foreground-dim">Ask a question or generate a plan to see Orion go to work.</p>
                  </div>
                </div>
              </Card>
            )}

            {/* Secondary queue: everything else waiting, quiet and out of
                the way of the one thing that actually needs a decision. */}
            {!justResolved && pendingActions.length > 1 && (
              <div className="-mt-4 space-y-1 rounded-lg border border-border bg-surface px-3 py-2">
                <p className="font-mono text-xs uppercase tracking-wide text-foreground-dim">Also waiting</p>
                {pendingActions.slice(1, 5).map((a) => {
                  const repoRef = a.plan_id ? planRepoMap.get(a.plan_id) : undefined;
                  const { label } = actionTypeMeta(a.action_type);
                  return (
                    <div key={a.id} className="flex items-center justify-between gap-3 text-xs">
                      <span className="truncate text-foreground-dim">
                        {repoRef && <span className="text-foreground">{repoRef.repoName} — </span>}
                        {label} <span className="font-mono">{a.target}</span>
                      </span>
                      {repoRef && (
                        <Link href={`/repos/${repoRef.repoId}/tasks`} className="shrink-0 text-accent hover:underline">
                          Review →
                        </Link>
                      )}
                    </div>
                  );
                })}
                {pendingActions.length > 5 && <p className="text-xs text-foreground-dim">+{pendingActions.length - 5} more pending</p>}
              </div>
            )}

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider text-accent">
                  <span aria-hidden="true">—</span>
                  Repository overview <span className="text-foreground-dim">({repos.length})</span>
                </h2>
                <Link href="/repos" className="text-xs text-accent hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent">
                  View all →
                </Link>
              </div>
              <DataTable>
                <thead>
                  <tr>
                    <DataTh>Name</DataTh>
                    <DataTh>Status</DataTh>
                    <DataTh>Summarized</DataTh>
                    <DataTh>Pending</DataTh>
                    <DataTh>Last action</DataTh>
                  </tr>
                </thead>
                <tbody>
                  {sortedRepos.slice(0, REPO_TABLE_LIMIT).map((repo) => {
                    const summaryPct = summaryPctByRepo.get(repo.id);
                    const pending = pendingCountByRepo.get(repo.id) ?? 0;
                    return (
                      <tr key={repo.id} className="transition-colors hover:bg-foreground-dim/5">
                        <DataTd>
                          <Link
                            href={repo.status === "ready" ? `/repos/${repo.id}/overview` : "/repos"}
                            className="text-foreground hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                          >
                            {repo.name}
                          </Link>
                        </DataTd>
                        <DataTd>
                          <RepoStatusPill status={repo.status} />
                        </DataTd>
                        <DataTd className="font-mono text-foreground-dim">
                          {summaryPct !== undefined ? `${Math.round(summaryPct * 100)}%` : "—"}
                        </DataTd>
                        <DataTd className="font-mono text-foreground-dim">{pending > 0 ? pending : "—"}</DataTd>
                        <DataTd className="text-foreground-dim">{timeAgo(latestActivityByRepo.get(repo.id) ?? repo.created_at)}</DataTd>
                      </tr>
                    );
                  })}
                </tbody>
              </DataTable>
            </section>

            <AddRepositoryCard cloneUrl={cloneUrl} setCloneUrl={setCloneUrl} submitting={submitting} onSubmit={handleSubmit} />
          </div>
        )}
      </div>
    </div>
  );
}
