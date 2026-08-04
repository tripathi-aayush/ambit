// Mirrors action-object.schema.json, which is the source of truth.
// Keep the two in lockstep by hand for now — codegen is overkill at this size.

export type ActionType =
  | "file_write"
  | "file_delete"
  | "git_commit"
  | "git_push"
  | "shell_exec"
  | "db_migration";

export type Adapter = "web_ui" | "claude_code" | "cli_wrapper";

export type Environment = "dev" | "staging" | "prod";

export interface ActionActor {
  adapter: Adapter;
  agent_name: string;
  user?: string | null;
}

export interface ActionObject {
  action_type: ActionType;
  target: string;
  actor: ActionActor;
  environment?: Environment;
  branch?: string | null;
  metadata?: Record<string, unknown>;
}
