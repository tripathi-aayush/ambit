// Ported near-verbatim from apps/web/src/lib/eventDetail.ts and
// apps/web/src/lib/time.ts -- both were already pure, framework-free
// functions operating only on plain data, so the CLI and the browser
// interpret the exact same event payloads the exact same way. Only the
// import path and the addition of ANSI color changed.

import pc from "picocolors";
import type { Action, ActionEvent, ActionStatus } from "./client";

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

export function riskReasons(events: ActionEvent[]): string[] {
  const event = events.find((e) => e.event_type === "risk_scored");
  return (event?.payload.reasons as string[] | undefined) ?? [];
}

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

export function timeAgo(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) {
    const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
    if (hours <= 0) return "just now";
    return `${hours}h ago`;
  }
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

// Same semantic mapping as apps/web/src/components/badges.tsx's
// STATUS_TEXT_COLORS / risk tokens -- risk-low/completed green,
// risk-medium/pending amber, risk-high/denied red. The CLI and the
// Control Room should agree on what "risky" looks like, just in ANSI
// instead of CSS variables.
export function colorStatus(status: ActionStatus | string): string {
  switch (status) {
    case "completed":
    case "approved":
      return pc.green(status);
    case "pending":
    case "executing":
      return pc.yellow(status);
    case "failed":
    case "denied":
      return pc.red(status);
    default:
      return pc.dim(status);
  }
}

export function colorRisk(level: string | null): string {
  if (!level) return pc.dim("—");
  switch (level) {
    case "low":
      return pc.green(level);
    case "medium":
      return pc.yellow(level);
    case "high":
      return pc.red(pc.bold(level));
    default:
      return level;
  }
}

export function actionLabel(action: Action): string {
  const type = action.action_type.replace(/_/g, " ");
  return `${type} ${action.target}`;
}
