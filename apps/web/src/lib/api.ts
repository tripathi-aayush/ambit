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
