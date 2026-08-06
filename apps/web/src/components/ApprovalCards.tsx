import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { RiskLabel } from "@/components/badges";
import { DiffView } from "@/components/DiffView";
import { actionTypeMeta } from "@/components/actionTypeIcons";
import { policyReasons, riskReasons } from "@/lib/eventDetail";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { type Action, type ActionEvent } from "@/lib/api";

export interface RepoRef {
  repoId: string;
  repoName: string;
}

// The primary object when something needs a human: the decision itself,
// expanded, with the reasoning already visible and the diff already
// shown — not a summary that sends you elsewhere to find those things.
// Shared by Home (the single most urgent item) and Approvals (whichever
// item is selected from the queue) so a decision looks the same wherever
// it's made.
export function DecisionCard({
  action,
  repoRef,
  events,
  eventsLoading,
  deciding,
  onDecide,
}: {
  action: Action;
  repoRef: RepoRef | undefined;
  events: ActionEvent[] | null;
  eventsLoading: boolean;
  deciding: "approved" | "denied" | null;
  onDecide: (decision: "approved" | "denied") => void;
}) {
  const { icon: Icon, label } = actionTypeMeta(action.action_type);
  const isHighRisk = action.risk_level === "high";
  const reasons = events ? riskReasons(events) : [];
  const policyMatch = events ? policyReasons(events) : [];
  const description = String(action.action_metadata.description ?? "");
  const showDiff = action.action_type === "file_write" || action.action_type === "file_delete";

  return (
    <Card tone={isHighRisk ? "danger" : "warning"} label="AWAITING YOUR APPROVAL">
      <div className="flex items-center gap-2 text-xs text-foreground-dim">
        {repoRef && <span className="text-foreground">{repoRef.repoName}</span>}
        <RiskLabel level={action.risk_level} score={action.risk_score} />
      </div>
      <p className="mt-1.5 flex items-center gap-2 font-display text-lg font-extrabold text-foreground">
        <Icon className="h-5 w-5 shrink-0" strokeWidth={2} />
        {label} <span className="font-mono text-base font-normal text-foreground-dim">{action.target}</span>
      </p>
      {description && <p className="mt-1 text-sm text-foreground-dim">{description}</p>}

      <div className="mt-3 space-y-1 border-t border-border pt-3 text-xs">
        {eventsLoading && <p className="text-foreground-dim">Loading reasoning…</p>}
        {!eventsLoading && reasons.length === 0 && policyMatch.length === 0 && (
          <p className="text-foreground-dim">No additional reasoning recorded.</p>
        )}
        {reasons.length > 0 && (
          <p className="text-foreground-dim">
            <span className="text-foreground">Why flagged — </span>
            {reasons.join("; ")}
          </p>
        )}
        {policyMatch.length > 0 && (
          <p className="text-foreground-dim">
            <span className="text-foreground">Policy — </span>
            {policyMatch.join("; ")}
          </p>
        )}
      </div>

      {showDiff && (
        <div className="mt-3">
          <DiffView action={action} />
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <Button
          variant={isHighRisk ? "destructive" : "primary"}
          disabled={deciding !== null}
          loading={deciding === "approved"}
          onClick={() => onDecide("approved")}
        >
          Approve
        </Button>
        <Button variant="secondary" disabled={deciding !== null} loading={deciding === "denied"} onClick={() => onDecide("denied")}>
          Deny
        </Button>
        {repoRef && (
          <Link
            href={`/repos/${repoRef.repoId}/tasks`}
            className="ml-auto text-xs text-accent hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            View full plan →
          </Link>
        )}
      </div>
    </Card>
  );
}

// The moment a decision is made, it becomes a visible fact in place —
// not a toast that fades, a record that was just written.
export function ResolvedCard({
  action,
  decision,
  repoRef,
  approver,
}: {
  action: Action;
  decision: "approved" | "denied";
  repoRef: RepoRef | undefined;
  approver: string;
}) {
  const isApproved = decision === "approved";
  const { label } = actionTypeMeta(action.action_type);
  return (
    <Card tone={isApproved ? "accent" : "danger"} className={isApproved ? "bg-accent/[0.06]" : "bg-risk-high-bg"}>
      <div className="flex items-center gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-current/10 ${isApproved ? "text-accent" : "text-risk-high"}`}>
          {isApproved ? <CheckCircle2 className="h-4.5 w-4.5" strokeWidth={2} /> : <XCircle className="h-4.5 w-4.5" strokeWidth={2} />}
        </div>
        <div className="min-w-0">
          <p className="text-sm text-foreground">
            {isApproved ? "Approved" : "Denied"}
            {repoRef && ` — ${repoRef.repoName}`} — {label} <span className="font-mono">{action.target}</span>
          </p>
          <p className="text-xs text-foreground-dim">Recorded just now by {approver}.</p>
        </div>
      </div>
    </Card>
  );
}
