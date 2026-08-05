const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface Repository {
  id: string;
  clone_url: string;
  name: string;
  status: "pending" | "processing" | "ready" | "failed";
  error: string | null;
  frameworks: string[];
  created_at: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatSource {
  kind: string;
  label: string;
  content: string;
  url: string | null;
  distance: number;
}

export interface ChatResponse {
  answer: string;
  sources: ChatSource[];
  not_enough_information: boolean;
}

export interface RepositoryDoc {
  readme_markdown: string;
  sequence_diagram_title: string;
  sequence_diagram_mermaid: string;
  model: string;
  source: string;
  created_at: string;
}

export interface DependencyEdge {
  source_file_id: string;
  target_file_id: string | null;
  target_external_name: string | null;
  edge_type: string;
}

export interface RepoFile {
  id: string;
  path: string;
  language: string | null;
  size_bytes: number;
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
  risk_level: string | null;
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
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${detail}`);
  }
  return res.json();
}

export function listRepos(): Promise<Repository[]> {
  return request("/repos");
}

export function getRepo(id: string): Promise<Repository> {
  return request(`/repos/${id}`);
}

export function createRepo(cloneUrl: string): Promise<Repository> {
  return request("/repos", {
    method: "POST",
    body: JSON.stringify({ clone_url: cloneUrl }),
  });
}

export function chat(repoId: string, messages: ChatMessage[]): Promise<ChatResponse> {
  return request(`/repos/${repoId}/chat`, {
    method: "POST",
    body: JSON.stringify({ messages }),
  });
}

export function getArchitecture(repoId: string): Promise<RepositoryDoc> {
  return request(`/repos/${repoId}/architecture`);
}

export function getGraph(repoId: string): Promise<DependencyEdge[]> {
  return request(`/repos/${repoId}/graph`);
}

export function listFiles(repoId: string): Promise<RepoFile[]> {
  return request(`/repos/${repoId}/files`);
}

export function createPlan(
  repoId: string,
  taskDescription: string,
  environment: "dev" | "staging" | "prod" = "dev"
): Promise<Plan> {
  return request(`/repos/${repoId}/plans`, {
    method: "POST",
    body: JSON.stringify({ task_description: taskDescription, environment }),
  });
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

export function getActionEvents(actionId: string): Promise<ActionEvent[]> {
  return request(`/actions/${actionId}/events`);
}

export function rollbackAction(actionId: string): Promise<Plan> {
  return request(`/actions/${actionId}/rollback`, { method: "POST" });
}

export interface AnalyticsSummary {
  total_actions: number;
  by_status: Record<string, number>;
  by_risk_level: Record<string, number>;
  approvals_approved: number;
  approvals_denied: number;
  total_plans: number;
  rollback_plans: number;
}

export function getAnalyticsSummary(): Promise<AnalyticsSummary> {
  return request("/analytics/summary");
}
