"use client";

import { use, useEffect, useMemo, useState } from "react";
import { type Edge, type Node } from "reactflow";
import { AlertTriangle, ExternalLink, ListTree, RotateCcw } from "lucide-react";
import { NODE_STATUS_COLORS, RiskLabel, StatusPill } from "@/components/badges";
import { DiffView } from "@/components/DiffView";
import { RepoNav } from "@/components/RepoNav";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { ActionGraph } from "@/components/graph/ActionGraph";
import { layoutWithDagre } from "@/components/graph/layout";
import { actionTypeMeta } from "@/components/actionTypeIcons";
import {
  createPlan,
  decideApproval,
  getAction,
  getPlan,
  getRepo,
  listPlans,
  type Action,
  type Plan,
  type Repository,
} from "@/lib/api";

function ActionDag({ actions }: { actions: Action[] }) {
  const { nodes, edges } = useMemo(() => {
    const rawNodes: Node[] = actions.map((a) => {
      const colors = NODE_STATUS_COLORS[a.status];
      return {
        id: a.id,
        data: { label: `${actionTypeMeta(a.action_type).label}\n${a.target || "(auto)"}\n${a.status}` },
        position: { x: 0, y: 0 },
        style: {
          fontSize: 11,
          width: 220,
          height: 64,
          whiteSpace: "pre-line",
          textAlign: "left",
          background: colors.bg,
          border: `1.5px solid ${colors.border}`,
          color: colors.text,
          borderRadius: 6,
          padding: 8,
        },
      };
    });
    const rawEdges: Edge[] = actions.flatMap((a) =>
      a.depends_on.map((depId) => ({
        id: `${depId}-${a.id}`,
        source: depId,
        target: a.id,
        type: "smoothstep",
        style: { stroke: "#c7c7c7" },
      }))
    );
    return layoutWithDagre(rawNodes, rawEdges, "LR");
  }, [actions]);

  return <ActionGraph nodes={nodes} edges={edges} height={300} />;
}

function planRiskRank(plan: Plan): number {
  const rank: Record<string, number> = { high: 3, medium: 2, low: 1 };
  return Math.max(0, ...plan.actions.map((a) => rank[a.risk_level ?? ""] ?? 0));
}

const RISK_DOT_COLOR: Record<number, string> = { 3: "bg-risk-high", 2: "bg-risk-medium", 1: "bg-risk-low" };

export default function TasksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [repo, setRepo] = useState<Repository | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [taskInput, setTaskInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [decidingDecision, setDecidingDecision] = useState<"approved" | "denied" | null>(null);
  const [environment, setEnvironment] = useState<"dev" | "staging" | "prod">("dev");
  const [plansLoading, setPlansLoading] = useState(true);
  const [revertedAction, setRevertedAction] = useState<Action | null>(null);

  const selected = plans.find((p) => p.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected?.reverts_action_id) {
      setRevertedAction(null);
      return;
    }
    getAction(selected.reverts_action_id)
      .then(setRevertedAction)
      .catch(() => setRevertedAction(null));
  }, [selected?.reverts_action_id]);

  const refreshPlans = () => {
    listPlans(id)
      .then((ps) => {
        setPlans(ps);
        if (ps.length > 0 && !selectedId) setSelectedId(ps[0].id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setPlansLoading(false));
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
    setDecidingDecision(decision);
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
      setDecidingDecision(null);
    }
  };

  const pendingActions = selected?.actions.filter((a) => a.status === "pending") ?? [];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-8">
      <PageHeader backHref="/repos" title={repo?.name ?? "…"} tabs={<RepoNav repoId={id} active="tasks" />} />

      <form onSubmit={handleSubmit} className="mb-6 flex gap-2">
        <input
          type="text"
          value={taskInput}
          onChange={(e) => setTaskInput(e.target.value)}
          placeholder="Describe a code change, e.g. 'add input validation to the reset endpoint'…"
          className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent dark:border-neutral-700 dark:bg-neutral-900"
        />
        <select
          value={environment}
          onChange={(e) => setEnvironment(e.target.value as "dev" | "staging" | "prod")}
          title="Target environment — affects risk scoring and which steps require human approval"
          className="rounded-md border border-neutral-300 px-2 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        >
          <option value="dev">dev</option>
          <option value="staging">staging</option>
          <option value="prod">prod</option>
        </select>
        <Button type="submit" loading={submitting}>
          {submitting ? "Planning…" : "Submit"}
        </Button>
      </form>

      {error && (
        <div className="mb-4">
          <ErrorMessage>{error}</ErrorMessage>
        </div>
      )}

      <div className="flex gap-6">
        <aside className="w-64 shrink-0 space-y-1 text-sm">
          {plansLoading && <p className="text-neutral-400 dark:text-neutral-500">Loading…</p>}
          {!plansLoading && plans.length === 0 && (
            <EmptyState icon={ListTree} title="No tasks yet" description="Submit one above to generate a plan." />
          )}
          {plans.map((p) => {
            const riskRank = planRiskRank(p);
            return (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className={`block w-full rounded-md px-2 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  p.id === selectedId ? "bg-neutral-100 dark:bg-neutral-800" : "hover:bg-neutral-50 dark:hover:bg-neutral-900"
                }`}
                title={p.task_description}
              >
                <div className="flex items-center gap-1.5">
                  {riskRank > 0 && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${RISK_DOT_COLOR[riskRank]}`} />}
                  <StatusPill status={p.status} />
                  {p.reverts_action_id && <RotateCcw className="h-3 w-3 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />}
                </div>
                <p className="mt-1 truncate text-neutral-700 dark:text-neutral-300">{p.task_description}</p>
                <p className="mt-0.5 text-xs text-neutral-400 dark:text-neutral-500">{new Date(p.created_at).toLocaleString()}</p>
              </button>
            );
          })}
        </aside>

        <div className="min-w-0 flex-1 space-y-4">
          {!selected && <p className="text-sm text-neutral-500 dark:text-neutral-400">Select or submit a task to see its plan.</p>}

          {selected && (
            <>
              {selected.reverts_action_id && (
                <div className="flex items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-400">
                  <RotateCcw className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                  {revertedAction ? (
                    <span>
                      Reverts <span className="font-medium text-neutral-800 dark:text-neutral-200">{revertedAction.action_type}</span>{" "}
                      on <span className="font-mono">{revertedAction.target}</span>
                    </span>
                  ) : (
                    <span>This plan reverts a previous action.</span>
                  )}
                </div>
              )}

              <Card className="text-xs">
                <p>
                  <span className="font-medium">Branch:</span> {selected.branch_name}
                </p>
                <p>
                  <span className="font-medium">Status:</span> {selected.status}
                </p>
                {selected.error && <p className="mt-1 text-red-600 dark:text-red-400">{selected.error}</p>}
              </Card>

              {selected.pr_url && (
                <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900 dark:border-green-900/40 dark:bg-green-950/20 dark:text-green-400">
                  <ExternalLink className="h-4 w-4 shrink-0" strokeWidth={2} />
                  Pull request opened:{" "}
                  <a
                    href={selected.pr_url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded font-medium underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {selected.pr_url}
                  </a>
                </div>
              )}

              <ActionDag actions={selected.actions} />

              {pendingActions.length > 0 && (
                <div className="space-y-2">
                  <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Awaiting approval</h2>
                  {pendingActions.map((a) => {
                    const isHighRisk = a.risk_level === "high";
                    const { icon: Icon, label } = actionTypeMeta(a.action_type);
                    return (
                      <div
                        key={a.id}
                        className={`rounded-md border px-3 py-2.5 text-xs ${
                          isHighRisk
                            ? "border-risk-high/40 bg-risk-high-bg"
                            : "border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="flex items-center gap-1.5 font-medium text-neutral-900 dark:text-neutral-100">
                              <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                              {label} <span className="font-mono">{a.target}</span>
                            </p>
                            <p className="mt-1 text-neutral-600 dark:text-neutral-400">{String(a.action_metadata.description ?? "")}</p>
                            {a.risk_level && (
                              <p className="mt-1">
                                risk: <RiskLabel level={a.risk_level} score={a.risk_score} />
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1.5">
                            {isHighRisk && (
                              <span className="flex items-center gap-1 text-[11px] font-medium text-risk-high">
                                <AlertTriangle className="h-3 w-3" strokeWidth={2} /> high risk
                              </span>
                            )}
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant={isHighRisk ? "destructive" : "primary"}
                                disabled={decidingId === a.id}
                                loading={decidingId === a.id && decidingDecision === "approved"}
                                onClick={() => handleDecide(a, "approved")}
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={decidingId === a.id}
                                loading={decidingId === a.id && decidingDecision === "denied"}
                                onClick={() => handleDecide(a, "denied")}
                              >
                                Deny
                              </Button>
                            </div>
                          </div>
                        </div>

                        {(a.action_type === "file_write" || a.action_type === "file_delete") && (
                          <div className="mt-2.5 border-t border-black/5 pt-2.5 dark:border-white/5">
                            <DiffView action={a} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
