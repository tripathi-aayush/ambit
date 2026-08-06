// Orion Phase 2: the event-interpretation logic that used to be ported
// verbatim here from apps/web/src/lib/eventDetail.ts now lives in
// @orion/shared/events.ts, imported directly -- one copy, not two kept
// in sync by hand. This file keeps only what's genuinely CLI-specific:
// ANSI color and terminal label formatting.

import pc from "picocolors";
import type { ActionStatus } from "./client";

export {
  describeEvent,
  riskReasons,
  policyReasons,
  executionOutcome,
  timeAgo,
  type ExecutionOutcome,
} from "@orion/shared";

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

// Accepts anything with these two fields -- both the full REST `Action`
// shape and the smaller `StreamActionEnvelope` the live SSE stream sends
// (see @orion/shared) satisfy this structurally, no cast needed at call
// sites either way.
export function actionLabel(action: { action_type: string; target: string }): string {
  const type = action.action_type.replace(/_/g, " ");
  return `${type} ${action.target}`;
}
