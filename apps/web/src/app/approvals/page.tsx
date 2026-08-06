"use client";

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import {
  decideApproval,
  getActionEvents,
  listAllActions,
  listPlans,
  listRepos,
  type Action,
  type ActionEvent,
  type Plan,
  type Repository,
} from "@/lib/api";
import { RiskLabel } from "@/components/badges";
import { DecisionCard, ResolvedCard, type RepoRef } from "@/components/ApprovalCards";
import { actionTypeMeta } from "@/components/actionTypeIcons";
import { notifyPendingChanged } from "@/lib/pendingSignal";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { SkeletonText } from "@/components/ui/Skeleton";

const RISK_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };
const APPROVER = "web-ui-user";

export default function ApprovalsPage() {
  const [pending, setPending] = useState<Action[]>([]);
  const [planRepoMap, setPlanRepoMap] = useState<Map<string, RepoRef>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [events, setEvents] = useState<ActionEvent[] | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [decidingChoice, setDecidingChoice] = useState<"approved" | "denied" | null>(null);
  const [justResolved, setJustResolved] = useState<{ action: Action; decision: "approved" | "denied"; repoRef: RepoRef | undefined } | null>(
    null
  );

  const refresh = async () => {
    const [repos, actions] = await Promise.all([listRepos(), listAllActions("pending")]);
    const sorted = [...actions].sort((a, b) => {
      const riskDiff = (RISK_RANK[b.risk_level ?? ""] ?? 0) - (RISK_RANK[a.risk_level ?? ""] ?? 0);
      return riskDiff !== 0 ? riskDiff : b.created_at.localeCompare(a.created_at);
    });
    setPending(sorted);

    const plansPerRepo = await Promise.all(repos.map((r: Repository) => listPlans(r.id).catch(() => [] as Plan[])));
    const planMap = new Map<string, RepoRef>();
    repos.forEach((repo, i) => {
      for (const plan of plansPerRepo[i]) planMap.set(plan.id, { repoId: repo.id, repoName: repo.name });
    });
    setPlanRepoMap(planMap);

    setSelectedId((current) => (current && sorted.some((a) => a.id === current) ? current : (sorted[0]?.id ?? null)));
  };

  useEffect(() => {
    setLoading(true);
    setError(null);
    refresh()
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = justResolved ? null : (pending.find((a) => a.id === selectedId) ?? null);

  useEffect(() => {
    if (!selected) {
      setEvents(null);
      return;
    }
    setEventsLoading(true);
    getActionEvents(selected.id)
      .then(setEvents)
      .catch(() => setEvents([]))
      .finally(() => setEventsLoading(false));
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDecide = async (action: Action, decision: "approved" | "denied") => {
    const repoRef = action.plan_id ? planRepoMap.get(action.plan_id) : undefined;
    setDecidingChoice(decision);
    setError(null);
    try {
      await decideApproval(action.id, decision, APPROVER);
      notifyPendingChanged();
      await refresh();
      setJustResolved({ action, decision, repoRef });
      setTimeout(() => setJustResolved(null), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDecidingChoice(null);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-8">
      <PageHeader
        title="Approvals"
        description="Every action across every repository that's waiting on a human decision, sorted by risk."
      />

      {loading && <SkeletonText lines={6} />}
      {error && <ErrorMessage>{error}</ErrorMessage>}

      {!loading && pending.length === 0 && !justResolved && (
        <div className="flex items-center gap-2 rounded-md border border-neutral-200 px-3 py-2.5 text-sm text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
          Nothing awaiting your review.
        </div>
      )}

      {!loading && (pending.length > 0 || justResolved) && (
        <div className="flex gap-6">
          <aside className="w-64 shrink-0 space-y-1 text-sm">
            {pending.map((a) => {
              const repoRef = a.plan_id ? planRepoMap.get(a.plan_id) : undefined;
              const { label } = actionTypeMeta(a.action_type);
              return (
                <button
                  key={a.id}
                  onClick={() => setSelectedId(a.id)}
                  className={`block w-full rounded-md px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    a.id === selectedId ? "bg-neutral-100 dark:bg-neutral-800" : "hover:bg-neutral-50 dark:hover:bg-neutral-900"
                  }`}
                >
                  {repoRef && <p className="truncate text-xs font-medium text-neutral-500 dark:text-neutral-400">{repoRef.repoName}</p>}
                  <p className="truncate text-neutral-800 dark:text-neutral-200">
                    {label} <span className="font-mono text-xs">{a.target}</span>
                  </p>
                  <RiskLabel level={a.risk_level} score={a.risk_score} className="text-xs" />
                </button>
              );
            })}
          </aside>

          <div className="min-w-0 flex-1">
            {justResolved ? (
              <ResolvedCard action={justResolved.action} decision={justResolved.decision} repoRef={justResolved.repoRef} approver={APPROVER} />
            ) : selected ? (
              <DecisionCard
                action={selected}
                repoRef={selected.plan_id ? planRepoMap.get(selected.plan_id) : undefined}
                events={events}
                eventsLoading={eventsLoading}
                deciding={decidingChoice}
                onDecide={(decision) => handleDecide(selected, decision)}
              />
            ) : (
              <p className="text-sm text-neutral-500 dark:text-neutral-400">Select an item to review.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
