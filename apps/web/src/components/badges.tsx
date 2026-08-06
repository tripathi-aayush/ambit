// Single source of truth for status/risk color across the app. Previously
// three independent color maps existed for the same handful of concepts
// (this file, a copy in the Home page for repo status, and a third in the
// Tasks page's DAG node styling) — consolidated here so a given status or
// risk level always looks the same everywhere it appears.

// Dot + mono label, not filled pills or bracket text -- matches the
// reference's "● live" convention. All backed by the --risk-* / theme
// tokens so light/dark ("paper") both resolve correctly.
const STATUS_TEXT_COLORS: Record<string, string> = {
  planning: "text-foreground-dim",
  pending: "text-risk-medium",
  pending_approval: "text-risk-medium",
  approved: "text-accent",
  executing: "text-risk-medium",
  completed: "text-risk-low",
  failed: "text-risk-high",
  denied: "text-risk-high",
};

export function StatusPill({ status }: { status: string }) {
  const color = STATUS_TEXT_COLORS[status] ?? "text-foreground-dim";
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-wide ${color}`}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
      {status.replace(/_/g, " ")}
    </span>
  );
}

// Repository ingestion status is a distinct enum from Action/Plan status —
// "pending" means something different in each (queued-to-clone vs.
// awaiting-approval) — so it gets its own map rather than being forced into
// STATUS_TEXT_COLORS above, but shares the same dot+label pattern.
const REPO_STATUS_TEXT_COLORS: Record<string, string> = {
  pending: "text-foreground-dim",
  processing: "text-risk-medium",
  ready: "text-risk-low",
  failed: "text-risk-high",
};

export function RepoStatusPill({ status }: { status: string }) {
  const color = REPO_STATUS_TEXT_COLORS[status] ?? "text-foreground-dim";
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-wide ${color}`}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
      {status}
    </span>
  );
}

// Backed by the --risk-* tokens in globals.css — the one place saturated,
// non-accent color is allowed to carry meaning, so it stays consistent with
// light/dark mode without being redefined per component.
const RISK_TEXT_CLASSES: Record<string, string> = {
  low: "text-risk-low",
  medium: "text-risk-medium",
  high: "text-risk-high",
};

export function RiskLabel({
  level,
  score,
  className = "",
}: {
  level: string | null;
  score: number | null;
  className?: string;
}) {
  if (!level) return null;
  return (
    <span className={`font-medium ${RISK_TEXT_CLASSES[level] ?? ""} ${className}`}>
      {level} ({score})
    </span>
  );
}

// Hex values for contexts that can't consume Tailwind classes at runtime —
// React Flow node `style` props render outside the Tailwind pipeline, so
// this is a second representation of the same STATUS_PILL_COLORS semantics,
// not a fourth independent decision. Keep the two in sync if a status is
// added or recolored.
export const NODE_STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  planning: { bg: "#f5f5f5", border: "#a3a3a3", text: "#404040" },
  pending: { bg: "#fef3c7", border: "#d97706", text: "#78350f" },
  approved: { bg: "#dbeafe", border: "#2563eb", text: "#1e3a8a" },
  executing: { bg: "#fde68a", border: "#d97706", text: "#78350f" },
  completed: { bg: "#dcfce7", border: "#16a34a", text: "#14532d" },
  failed: { bg: "#fee2e2", border: "#dc2626", text: "#7f1d1d" },
  denied: { bg: "#fee2e2", border: "#dc2626", text: "#7f1d1d" },
};
