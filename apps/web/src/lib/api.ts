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
