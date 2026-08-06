// Single source of truth for status/risk color across the app. Previously
// three independent color maps existed for the same handful of concepts
// (this file, a copy in the Home page for repo status, and a third in the
// Tasks page's DAG node styling) — consolidated here so a given status or
// risk level always looks the same everywhere it appears.

const STATUS_PILL_COLORS: Record<string, string> = {
  planning: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  pending_approval: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  approved: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  executing: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  denied: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_PILL_COLORS[status] ?? "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

// Repository ingestion status is a distinct enum from Action/Plan status —
// "pending" means something different in each (queued-to-clone vs.
// awaiting-approval) — so it gets its own map rather than being forced into
// STATUS_PILL_COLORS above, but shares the same pill component pattern.
const REPO_STATUS_PILL_COLORS: Record<string, string> = {
  pending: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  processing: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  ready: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

export function RepoStatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${REPO_STATUS_PILL_COLORS[status] ?? "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"}`}
    >
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

const RISK_BG_CLASSES: Record<string, string> = {
  low: "bg-risk-low-bg text-risk-low",
  medium: "bg-risk-medium-bg text-risk-medium",
  high: "bg-risk-high-bg text-risk-high",
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

export function RiskBadge({ level, score }: { level: string | null; score: number | null }) {
  if (!level) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${RISK_BG_CLASSES[level] ?? "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"}`}
    >
      {level} risk{typeof score === "number" ? ` · ${score}` : ""}
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
