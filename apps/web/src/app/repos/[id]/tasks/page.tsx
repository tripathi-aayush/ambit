"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import ReactFlow, { Background, Controls, type Edge, type Node } from "reactflow";
import "reactflow/dist/style.css";
import {
  createPlan,
  decideApproval,
  getPlan,
  getRepo,
  listPlans,
  type Action,
  type Plan,
  type Repository,
} from "@/lib/api";

const STATUS_COLORS: Record<Action["status"], { bg: string; border: string }> = {
  pending: { bg: "#fef3c7", border: "#d97706" },
  approved: { bg: "#dbeafe", border: "#2563eb" },
  executing: { bg: "#fde68a", border: "#d97706" },
  completed: { bg: "#dcfce7", border: "#16a34a" },
  failed: { bg: "#fee2e2", border: "#dc2626" },
  denied: { bg: "#fee2e2", border: "#dc2626" },
};

const RISK_COLORS: Record<string, string> = {
  low: "text-green-700",
  medium: "text-amber-700",
  high: "text-red-700",
};

function ActionDag({ actions, onDecide }: { actions: Action[]; onDecide: (a: Action, decision: "approved" | "denied") => void }) {
  const { nodes, edges } = useMemo(() => {
    const columns = Math.max(1, Math.ceil(Math.sqrt(actions.length)));
    const nodes: Node[] = actions.map((a, i) => {
      const colors = STATUS_COLORS[a.status];
      return {
        id: a.id,
        data: { label: `${a.action_type}\n${a.target || "(auto)"}\n${a.status}` },
        position: { x: (i % columns) * 260, y: Math.floor(i / columns) * 110 },
        style: {
          fontSize: 11,
          width: 220,
          whiteSpace: "pre-line",
          textAlign: "left",
          background: colors.bg,
          border: `2px solid ${colors.border}`,
          padding: 8,
        },
      };
    });
    const edges: Edge[] = actions.flatMap((a) =>
      a.depends_on.map((depId) => ({ id: `${depId}-${a.id}`, source: depId, target: a.id }))
    );
    return { nodes, edges };
  }, [actions]);

  return (
    <div style={{ height: 320 }} className="rounded-md border border-neutral-200">
      <ReactFlow nodes={nodes} edges={edges} fitView>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export default function TasksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [repo, setRepo] = useState<Repository | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [taskInput, setTaskInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [environment, setEnvironment] = useState<"dev" | "staging" | "prod">("dev");

  const selected = plans.find((p) => p.id === selectedId) ?? null;

  const refreshPlans = () => {
    listPlans(id)
      .then((ps) => {
        setPlans(ps);
        if (ps.length > 0 && !selectedId) setSelectedId(ps[0].id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  useEffect(() => {
    getRepo(id).then(setRepo).catch((err) => setError(err instanceof Error ? err.message : String(err)));
    refreshPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const task = taskInput.trim();
    if (!task || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const plan = await createPlan(id, task, environment);
      setTaskInput("");
      setPlans((prev) => [plan, ...prev]);
      setSelectedId(plan.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecide = async (action: Action, decision: "approved" | "denied") => {
    setDecidingId(action.id);
    setError(null);
    try {
      await decideApproval(action.id, decision, "web-ui-user");
      if (action.plan_id) {
        const updated = await getPlan(action.plan_id);
        setPlans((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDecidingId(null);
    }
  };

  const pendingActions = selected?.actions.filter((a) => a.status === "pending") ?? [];

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
          <Link href={`/repos/${id}/architecture`} className="text-neutral-500 hover:underline">
            Architecture
          </Link>
          <span className="font-medium text-neutral-900">Tasks</span>
        </nav>
      </header>

      <form onSubmit={handleSubmit} className="mb-6 flex gap-2">
        <input
          type="text"
          value={taskInput}
          onChange={(e) => setTaskInput(e.target.value)}
          placeholder="Describe a code change, e.g. 'add input validation to the reset endpoint'…"
          className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
        <select
          value={environment}
          onChange={(e) => setEnvironment(e.target.value as "dev" | "staging" | "prod")}
          title="Target environment — affects risk scoring and which steps require human approval"
          className="rounded-md border border-neutral-300 px-2 py-2 text-sm"
        >
          <option value="dev">dev</option>
          <option value="staging">staging</option>
          <option value="prod">prod</option>
        </select>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? "Planning…" : "Submit"}
        </button>
      </form>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="flex gap-6">
        <aside className="w-56 shrink-0 space-y-1 text-sm">
          {plans.length === 0 && <p className="text-neutral-500">No tasks submitted yet.</p>}
          {plans.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className={`block w-full truncate rounded px-2 py-1.5 text-left ${
                p.id === selectedId ? "bg-neutral-100 font-medium" : "hover:bg-neutral-50"
              }`}
              title={p.task_description}
            >
              <span className={p.status === "failed" ? "text-red-600" : p.status === "completed" ? "text-green-700" : "text-neutral-700"}>
                {p.status}
              </span>{" "}
              — {p.task_description}
            </button>
          ))}
        </aside>

        <div className="min-w-0 flex-1 space-y-4">
          {!selected && <p className="text-sm text-neutral-500">Select or submit a task to see its plan.</p>}

          {selected && (
            <>
              <div className="rounded-md border border-neutral-200 px-3 py-2 text-xs">
                <p>
                  <span className="font-medium">Branch:</span> {selected.branch_name}
                </p>
                <p>
                  <span className="font-medium">Status:</span> {selected.status}
                </p>
                {selected.error && <p className="mt-1 text-red-600">{selected.error}</p>}
              </div>

              {selected.pr_url && (
                <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm">
                  Pull request opened:{" "}
                  <a href={selected.pr_url} target="_blank" rel="noreferrer" className="font-medium underline">
                    {selected.pr_url}
                  </a>
                </div>
              )}

              <ActionDag actions={selected.actions} onDecide={handleDecide} />

              {pendingActions.length > 0 && (
                <div className="space-y-2">
                  <h2 className="text-sm font-semibold text-neutral-700">Awaiting approval</h2>
                  {pendingActions.map((a) => (
                    <div key={a.id} className="flex items-start justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
                      <div>
                        <p className="font-medium">
                          {a.action_type} — {a.target}
                        </p>
                        <p className="text-neutral-600">{String(a.action_metadata.description ?? "")}</p>
                        {a.risk_level && (
                          <p className={`mt-1 ${RISK_COLORS[a.risk_level] ?? ""}`}>
                            risk: {a.risk_level} ({a.risk_score})
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          disabled={decidingId === a.id}
                          onClick={() => handleDecide(a, "approved")}
                          className="rounded bg-neutral-900 px-2 py-1 text-white disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          disabled={decidingId === a.id}
                          onClick={() => handleDecide(a, "denied")}
                          className="rounded border border-neutral-300 px-2 py-1 disabled:opacity-50"
                        >
                          Deny
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
