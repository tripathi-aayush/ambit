// Mirrors apps/web/src/lib/api.ts's conventions deliberately: one
// request<T> helper, same X-Orion-Key header, same snake_case response
// shapes, same plain-Error-on-non-ok behavior -- the CLI and the browser
// should describe the same server the same way, just to two different
// mediums. The only real difference is where credentials come from
// (config file here, NEXT_PUBLIC_* build-time env there).

import { loadConfig } from "./config";
import type { Adapter } from "@orion/shared";

export interface Repository {
  id: string;
  clone_url: string;
  name: string;
  status: "pending" | "processing" | "ready" | "failed";
  error: string | null;
  frameworks: string[];
  created_at: string;
}

export type ActionStatus = "pending" | "approved" | "denied" | "executing" | "completed" | "failed";

export interface Action {
  id: string;
  action_type: "file_write" | "file_delete" | "git_commit" | "git_push" | "shell_exec" | "db_migration";
  target: string;
  actor_adapter: string;
  actor_agent_name: string;
  actor_user: string | null;
  environment: string;
  branch: string | null;
  action_metadata: Record<string, unknown>;
  status: ActionStatus;
  risk_score: number | null;
  risk_level: "low" | "medium" | "high" | null;
  plan_id: string | null;
  depends_on: string[];
  created_at: string;
}

export type PlanStatus = "planning" | "pending_approval" | "executing" | "completed" | "failed";

export interface Plan {
  id: string;
  repository_id: string;
  task_description: string;
  branch_name: string;
  status: PlanStatus;
  pr_url: string | null;
  error: string | null;
  reverts_action_id: string | null;
  created_at: string;
  actions: Action[];
}

export interface ActionEvent {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const config = loadConfig();
  if (!config) {
    throw new Error("Not logged in. Run `orion login` first.");
  }
  const res = await fetch(`${config.apiUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "X-Orion-Key": config.apiKey, ...init?.headers },
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${detail}`);
  }
  // Node's built-in fetch types (via @types/node) return Promise<unknown>
  // here, stricter than DOM lib's Promise<any> -- an explicit cast is the
  // correct fix, not a lib/target change just to loosen this one call.
  return (await res.json()) as T;
}

export function listRepos(): Promise<Repository[]> {
  return request("/repos");
}

export function getRepo(id: string): Promise<Repository> {
  return request(`/repos/${id}`);
}

export function createRepo(cloneUrl: string): Promise<Repository> {
  return request("/repos", { method: "POST", body: JSON.stringify({ clone_url: cloneUrl }) });
}

export function createPlan(
  repoId: string,
  taskDescription: string,
  options: { dryRun?: boolean; adapter?: Adapter; environment?: "dev" | "staging" | "prod" } = {}
): Promise<Plan> {
  return request(`/repos/${repoId}/plans`, {
    method: "POST",
    body: JSON.stringify({
      task_description: taskDescription,
      environment: options.environment ?? "dev",
      dry_run: options.dryRun ?? false,
      adapter: options.adapter ?? "cli_wrapper",
    }),
  });
}

export function runPlan(planId: string): Promise<Plan> {
  return request(`/plans/${planId}/run`, { method: "POST" });
}

export function listPlans(repoId: string): Promise<Plan[]> {
  return request(`/repos/${repoId}/plans`);
}

export function getPlan(planId: string): Promise<Plan> {
  return request(`/plans/${planId}`);
}

export function decideApproval(
  actionId: string,
  decision: "approved" | "denied",
  approver: string,
  reason?: string
): Promise<Action> {
  return request(`/approvals/${actionId}`, {
    method: "POST",
    body: JSON.stringify({ approver, decision, reason }),
  });
}

export function listAllActions(status?: ActionStatus): Promise<Action[]> {
  return request(`/actions${status ? `?status=${status}` : ""}`);
}

export function getAction(actionId: string): Promise<Action> {
  return request(`/actions/${actionId}`);
}

export function getActionEvents(actionId: string): Promise<ActionEvent[]> {
  return request(`/actions/${actionId}/events`);
}
