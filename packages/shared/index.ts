// Mirrors action-object.schema.json, which is the source of truth.
// Keep the two in lockstep by hand for now — codegen is overkill at this size.
//
// Orion Phase 2: this package now has a real build step (`npm run build`
// here, or via the root install) -- it didn't need one before because
// every export was a type, erased entirely at compile time by whichever
// package imported it, so raw .ts source as `main` never actually got
// executed at runtime. events.ts/time.ts added real functions, and a
// plain Node process (the CLI) can't execute .ts directly the way
// Next.js's own bundler transparently can for apps/web -- so `main`/
// `types` now point at `dist/`, run this package's build after editing
// anything here, same as any other change to a compiled dependency.

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

export * from "./events";
export * from "./time";
