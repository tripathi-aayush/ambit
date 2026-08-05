"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { diffLines } from "diff";
import {
  getActionEvents,
  getPlan,
  listAllActions,
  rollbackAction,
  type Action,
  type ActionEvent,
  type ActionStatus,
} from "@/lib/api";

const STATUS_COLORS: Record<ActionStatus, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-blue-100 text-blue-800",
  executing: "bg-amber-100 text-amber-800",
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  denied: "bg-red-100 text-red-800",
};

const RISK_COLORS: Record<string, string> = {
  low: "text-green-700",
  medium: "text-amber-700",
  high: "text-red-700",
};

const REVERTABLE_TYPES = new Set(["file_write", "file_delete"]);

function DiffView({ action }: { action: Action }) {
  const previous = action.action_metadata.previous_content;
  const current = action.action_type === "file_write" ? action.action_metadata.content : "";
  if (typeof previous !== "string" && typeof current !== "string") {
    return <p className="text-xs text-neutral-500">No diffable content captured for this action.</p>;
  }

  const parts = diffLines((previous as string) ?? "", (current as string) ?? "");

  return (
    <pre className="max-h-80 overflow-auto rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs leading-relaxed">
      {parts.map((part, i) => (
        <span
          key={i}
          className={
            part.added
              ? "block bg-green-100 text-green-800"
              : part.removed
                ? "block bg-red-100 text-red-800"
                : "block text-neutral-500"
          }
        >
          {part.value
            .split("\n")
            .filter((_, idx, arr) => idx < arr.length - 1)
            .map((line, li) => (
              <span key={li} className="block">
                {part.added ? "+ " : part.removed ? "- " : "  "}
                {line}
              </span>
            ))}
        </span>
      ))}
    </pre>
  );
}

function ActionRow({ action, onChanged }: { action: Action; onChanged: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [events, setEvents] = useState<ActionEvent[] | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
  const [rollbackMessage, setRollbackMessage] = useState<string | null>(null);
  const [repoId, setRepoId] = useState<string | null>(null);

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
    <div className="border-b border-neutral-100 py-3">
      <button onClick={toggle} className="flex w-full items-center justify-between gap-3 text-left text-sm">
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 font-mono text-xs text-neutral-400">{new Date(action.created_at).toLocaleString()}</span>
          <span className="shrink-0 font-medium">{action.action_type}</span>
          <span className="truncate text-neutral-600">{action.target || "(auto)"}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {action.risk_level && (
            <span className={`text-xs ${RISK_COLORS[action.risk_level] ?? ""}`}>
              {action.risk_level} ({action.risk_score})
            </span>
          )}
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[action.status]}`}>
            {action.status}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="mt-3 space-y-3 pl-4 text-xs">
          <p className="text-neutral-600">
            {String(action.action_metadata.description ?? "")} — via {action.actor_adapter} / {action.actor_agent_name}
            {action.environment !== "dev" && ` (${action.environment})`}
          </p>

          {repoId && action.plan_id && (
            <Link href={`/repos/${repoId}/tasks`} className="text-blue-700 hover:underline">
              View plan in Tasks →
            </Link>
          )}

          {(action.action_type === "file_write" || action.action_type === "file_delete") && (
            <DiffView action={action} />
          )}

          <div>
            <h3 className="mb-1 font-semibold text-neutral-700">Audit trail</h3>
            {events === null && <p className="text-neutral-400">Loading…</p>}
            {events && events.length === 0 && <p className="text-neutral-400">No events.</p>}
            {events && (
              <ul className="space-y-1">
                {events.map((e) => (
                  <li key={e.id} className="text-neutral-600">
                    <span className="font-mono text-neutral-400">{new Date(e.created_at).toLocaleTimeString()}</span>{" "}
                    <span className="font-medium">{e.event_type}</span>
                    {e.event_type === "risk_scored" && ` — ${(e.payload.reasons as string[])?.join("; ")}`}
                    {e.event_type === "policy_evaluated" &&
                      ` — allow: ${e.payload.allow}, requires approval: ${e.payload.require_approval}`}
                    {e.event_type === "approval_decided" &&
                      ` — ${e.payload.approver}: ${e.payload.decision}${e.payload.reason ? ` (${e.payload.reason})` : ""}`}
                    {e.event_type === "execution_failed" && ` — ${e.payload.error}`}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {REVERTABLE_TYPES.has(action.action_type) && action.status === "completed" && (
            <div>
              <button
                onClick={handleRollback}
                disabled={rollingBack}
                className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50"
              >
                {rollingBack ? "Reverting…" : "Revert this action"}
              </button>
              {rollbackMessage && <p className="mt-1 text-neutral-600">{rollbackMessage}</p>}
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

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-8">
      <header className="mb-4 border-b border-neutral-200 pb-4">
        <Link href="/" className="text-xs text-neutral-500 hover:underline">
          ← All repositories
        </Link>
        <h1 className="text-lg font-semibold">Timeline</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Every action across every adapter — risk flags, approvals, and execution outcomes.
        </p>
      </header>

      <div className="mb-3 flex items-center gap-2 text-sm">
        <label htmlFor="status-filter" className="text-neutral-500">
          Filter:
        </label>
        <select
          id="status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ActionStatus | "all")}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
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

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-neutral-400">Loading…</p>}
      {!loading && actions.length === 0 && <p className="text-sm text-neutral-500">No actions yet.</p>}

      <div>
        {actions.map((a) => (
          <ActionRow key={a.id} action={a} onChanged={refresh} />
        ))}
      </div>
    </div>
  );
}
