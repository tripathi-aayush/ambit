"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, History, RotateCcw } from "lucide-react";
import { RiskLabel, StatusPill } from "@/components/badges";
import { actionTypeMeta } from "@/components/actionTypeIcons";
import { DiffView } from "@/components/DiffView";
import { describeEvent } from "@/lib/eventDetail";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { SkeletonRow } from "@/components/ui/Skeleton";
import {
  getActionEvents,
  getPlan,
  listAllActions,
  rollbackAction,
  type Action,
  type ActionEvent,
  type ActionStatus,
} from "@/lib/api";

const REVERTABLE_TYPES = new Set(["file_write", "file_delete"]);
const RISK_LEVELS = ["low", "medium", "high"] as const;

function ActionRow({ action, onChanged }: { action: Action; onChanged: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [events, setEvents] = useState<ActionEvent[] | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
  const [rollbackMessage, setRollbackMessage] = useState<string | null>(null);
  const [repoId, setRepoId] = useState<string | null>(null);

  const { icon: Icon, label } = actionTypeMeta(action.action_type);

  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next) {
      if (events === null) {
        getActionEvents(action.id)
          .then(setEvents)
          .catch(() => setEvents([]));
      }
      if (action.plan_id && repoId === null) {
        getPlan(action.plan_id)
          .then((p) => setRepoId(p.repository_id))
          .catch(() => {});
      }
    }
  };

  const handleRollback = async () => {
    setRollingBack(true);
    setRollbackMessage(null);
    try {
      const plan = await rollbackAction(action.id);
      if (plan.status === "completed" && plan.pr_url) {
        setRollbackMessage(`Revert PR opened: ${plan.pr_url}`);
      } else if (plan.status === "completed") {
        setRollbackMessage("Reverted — no new PR needed (branch already matched the base).");
      } else if (plan.status === "pending_approval") {
        setRollbackMessage("Revert plan created — a step requires approval before it can complete.");
      } else {
        setRollbackMessage(`Revert failed: ${plan.error ?? "unknown error"}`);
      }
      onChanged();
    } catch (err) {
      setRollbackMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setRollingBack(false);
    }
  };

  return (
    <div className="border-b border-neutral-100 py-3 dark:border-neutral-900">
      <button
        onClick={toggle}
        className="flex w-full items-center justify-between gap-3 rounded-md text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <div className="flex min-w-0 items-center gap-3">
          <ChevronRight
            className={`h-3.5 w-3.5 shrink-0 text-neutral-300 transition-transform dark:text-neutral-600 ${expanded ? "rotate-90" : ""}`}
            strokeWidth={2}
          />
          <span className="shrink-0 font-mono text-xs text-neutral-400 dark:text-neutral-500">{new Date(action.created_at).toLocaleString()}</span>
          <Icon className="h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
          <span className="shrink-0 font-medium text-neutral-900 dark:text-neutral-100">{label}</span>
          <span className="truncate text-neutral-600 dark:text-neutral-400">{action.target || "(auto)"}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <RiskLabel level={action.risk_level} score={action.risk_score} className="text-xs" />
          <StatusPill status={action.status} />
        </div>
      </button>

      {expanded && (
        <div className="mt-3 space-y-3 pl-9 text-xs">
          <p className="text-neutral-600 dark:text-neutral-400">
            {String(action.action_metadata.description ?? "")} — via {action.actor_adapter} / {action.actor_agent_name}
            {action.environment !== "dev" && ` (${action.environment})`}
          </p>

          {repoId && action.plan_id && (
            <Link
              href={`/repos/${repoId}/tasks`}
              className="inline-block rounded text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              View plan in Tasks →
            </Link>
          )}

          {(action.action_type === "file_write" || action.action_type === "file_delete") && (
            <DiffView action={action} />
          )}

          <div>
            <h3 className="mb-1 font-semibold text-neutral-700 dark:text-neutral-300">Audit trail</h3>
            {events === null && <p className="text-neutral-400 dark:text-neutral-500">Loading…</p>}
            {events && events.length === 0 && <p className="text-neutral-400 dark:text-neutral-500">No events.</p>}
            {events && (
              <ul className="space-y-1">
                {events.map((e) => {
                  const output = e.payload.output as Record<string, unknown> | undefined;
                  const prUrl = e.event_type === "execution_completed" && typeof output?.pr_url === "string" ? output.pr_url : null;
                  const detail = describeEvent(e);
                  return (
                    <li key={e.id} className="text-neutral-600 dark:text-neutral-400">
                      <span className="font-mono text-neutral-400 dark:text-neutral-500">
                        {new Date(e.created_at).toLocaleTimeString()}
                      </span>{" "}
                      <span className="font-medium text-neutral-800 dark:text-neutral-200">{e.event_type.replace(/_/g, " ")}</span>
                      {prUrl ? (
                        <>
                          {" — PR opened: "}
                          <a
                            href={prUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded text-accent underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            {prUrl}
                          </a>
                        </>
                      ) : (
                        detail && ` — ${detail}`
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {REVERTABLE_TYPES.has(action.action_type) && action.status === "completed" && (
            <div>
              <Button variant="secondary" size="sm" onClick={handleRollback} loading={rollingBack}>
                {!rollingBack && <RotateCcw className="h-3 w-3" strokeWidth={2} />}
                {rollingBack ? "Reverting…" : "Revert this action"}
              </Button>
              {rollbackMessage && <p className="mt-1 text-neutral-600 dark:text-neutral-400">{rollbackMessage}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TimelinePage() {
  const [actions, setActions] = useState<Action[]>([]);
  const [statusFilter, setStatusFilter] = useState<ActionStatus | "all">("all");
  const [riskFilter, setRiskFilter] = useState<(typeof RISK_LEVELS)[number] | "all">("all");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    listAllActions(statusFilter === "all" ? undefined : statusFilter)
      .then(setActions)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const visibleActions = useMemo(
    () => (riskFilter === "all" ? actions : actions.filter((a) => a.risk_level === riskFilter)),
    [actions, riskFilter]
  );

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-8">
      <PageHeader
        title="Audit Log"
        description="The permanent record — every action, every decision, every reason, across every repository."
      />

      <div className="mb-3 flex items-center gap-4 text-sm">
        <div className="flex items-center gap-2">
          <label htmlFor="status-filter" className="text-neutral-500 dark:text-neutral-400">
            Status
          </label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ActionStatus | "all")}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="all">all</option>
            <option value="pending">pending</option>
            <option value="approved">approved</option>
            <option value="executing">executing</option>
            <option value="completed">completed</option>
            <option value="failed">failed</option>
            <option value="denied">denied</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="risk-filter" className="text-neutral-500 dark:text-neutral-400">
            Risk
          </label>
          <select
            id="risk-filter"
            value={riskFilter}
            onChange={(e) => setRiskFilter(e.target.value as (typeof RISK_LEVELS)[number] | "all")}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="all">all</option>
            {RISK_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="mb-4">
          <ErrorMessage>{error}</ErrorMessage>
        </div>
      )}
      {loading && (
        <div className="space-y-2">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      )}
      {!loading && visibleActions.length === 0 && (
        <EmptyState icon={History} title="No actions match" description="Nothing here yet for this filter combination." />
      )}

      <div>
        {visibleActions.map((a) => (
          <ActionRow key={a.id} action={a} onChanged={refresh} />
        ))}
      </div>
    </div>
  );
}
