// Orion Phase 2 (live runtime): the event-interpretation logic that used
// to be duplicated verbatim between apps/web/src/lib/eventDetail.ts and
// apps/cli/src/format.ts, moved here so there's exactly one copy. Neither
// original ever touched React or Node -- both were already pure functions
// over plain data, so this moves cleanly. The CLI and the browser now
// interpret every event payload (including the new "shell_output" case
// added in this phase) through the same code, not two hand-kept-in-sync
// copies.

export interface ActionEvent {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export function describeEvent(event: ActionEvent): string | null {
  const p = event.payload;
  switch (event.event_type) {
    case "risk_scored":
      return (p.reasons as string[] | undefined)?.join("; ") || null;
    case "policy_evaluated": {
      if (p.allow === false) {
        const reasons = (p.deny_reasons as string[] | undefined) ?? [];
        return `denied${reasons.length ? ` — ${reasons.join("; ")}` : ""}`;
      }
      if (p.require_approval) {
        const reasons = (p.approval_reasons as string[] | undefined) ?? [];
        return `requires approval${reasons.length ? ` — ${reasons.join("; ")}` : ""}`;
      }
      return "allowed, no approval required";
    }
    case "decided": {
      const reasons = (p.reasons as string[] | undefined) ?? [];
      return `${p.decision} by ${p.by}${reasons.length ? ` — ${reasons.join("; ")}` : ""}`;
    }
    case "approval_requested":
      return (p.reasons as string[] | undefined)?.join("; ") || null;
    case "approval_decided":
      return `${p.approver}: ${p.decision}${p.reason ? ` (${p.reason})` : ""}`;
    case "shell_output":
      // Rendered specially (streamed line-by-line, not as a one-line
      // "description") by any live consumer -- this case exists so
      // describeEvent still returns *something* sane for a static/
      // non-live view (e.g. `orion review`, the browser's audit log).
      return typeof p.line === "string" ? p.line : null;
    case "execution_completed": {
      // executor.py wraps the per-action-type result dict under "output",
      // not at the payload root -- {"output": {"wrote_bytes": 13}}, etc.
      const o = (p.output as Record<string, unknown> | undefined) ?? {};
      if (typeof o.note === "string") return o.note;
      if (typeof o.commit_sha === "string") return `commit ${o.commit_sha.slice(0, 7)}`;
      if (typeof o.wrote_bytes === "number") return `wrote ${o.wrote_bytes} bytes`;
      if (typeof o.pr_url === "string") return `PR opened`;
      if (typeof o.exit_code === "number") {
        const stdout = typeof o.stdout === "string" ? o.stdout.trim() : "";
        const preview = stdout.length > 200 ? `${stdout.slice(0, 200)}…` : stdout;
        return `exit ${o.exit_code}${preview ? ` — ${preview}` : ""}`;
      }
      return null;
    }
    case "execution_failed":
      return typeof p.error === "string" ? p.error : null;
    default:
      return null;
  }
}

// Pull the risk_scored reasons specifically -- the "why is this in front
// of me" text a decision surface needs, distinct from the general
// per-event description above.
export function riskReasons(events: ActionEvent[]): string[] {
  const event = events.find((e) => e.event_type === "risk_scored");
  return (event?.payload.reasons as string[] | undefined) ?? [];
}

// Pull the policy match text specifically -- why this needed a human, as
// opposed to why it scored the way it did.
export function policyReasons(events: ActionEvent[]): string[] {
  const event = events.find((e) => e.event_type === "policy_evaluated");
  return (event?.payload.approval_reasons as string[] | undefined) ?? [];
}

export interface ExecutionOutcome {
  commitSha: string | null;
  prUrl: string | null;
  wroteBytes: number | null;
  note: string | null;
  exitCode: number | null;
}

export function executionOutcome(events: ActionEvent[]): ExecutionOutcome | null {
  const event = events.find((e) => e.event_type === "execution_completed");
  if (!event) return null;
  const o = (event.payload.output as Record<string, unknown> | undefined) ?? {};
  return {
    commitSha: typeof o.commit_sha === "string" ? o.commit_sha : null,
    prUrl: typeof o.pr_url === "string" ? o.pr_url : null,
    wroteBytes: typeof o.wrote_bytes === "number" ? o.wrote_bytes : null,
    note: typeof o.note === "string" ? o.note : null,
    exitCode: typeof o.exit_code === "number" ? o.exit_code : null,
  };
}

// --- Live stream envelope types -------------------------------------
// Mirror services/core/app/api/plans.py's stream_plan / app/events.py's
// event_message exactly -- one shape, hand-kept-in-sync with the Python
// side the same way ActionObject already is (see this package's own
// header comment), not codegen'd.

export interface StreamActionEnvelope {
  id: string;
  action_type: string;
  target: string;
  risk_level: "low" | "medium" | "high" | null;
  status: string;
}

export interface ActionEventMessage {
  type: "action_event";
  action: StreamActionEnvelope;
  event: ActionEvent;
}

export interface PlanSnapshotMessage {
  type: "plan_snapshot";
  id: string;
  repository_id: string;
  task_description: string;
  branch_name: string;
  status: string;
  pr_url: string | null;
  error: string | null;
  actions: unknown[];
}

export interface StreamEndMessage {
  type: "stream_end";
  plan_id: string;
}

export interface StreamErrorMessage {
  type: "error";
  detail: string;
}

export type PlanStreamMessage = ActionEventMessage | PlanSnapshotMessage | StreamEndMessage | StreamErrorMessage;
