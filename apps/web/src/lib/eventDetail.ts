import type { ActionEvent } from "@/lib/api";

// The whole point of showing an action to a human is that the reasoning
// has to be visible, not one click away -- this turns raw event payloads
// (risk score reasons, policy match text, sandbox/commit/PR output) into
// plain sentences. Shared by Timeline's full audit trail and Home's
// single-decision / single-proof surfaces, which need the same reasoning
// but only ever fetch it for one action at a time.
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

// Pull the policy match text specifically -- why this needed a human,
// as opposed to why it scored the way it did.
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
