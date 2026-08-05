// Shared status/risk styling for Action and Plan states — used by the
// Tasks and Timeline pages so a given status/risk level always renders
// identically no matter which page shows it.

const STATUS_PILL_COLORS: Record<string, string> = {
  planning: "bg-neutral-100 text-neutral-600",
  pending: "bg-amber-100 text-amber-800",
  pending_approval: "bg-amber-100 text-amber-800",
  approved: "bg-blue-100 text-blue-800",
  executing: "bg-amber-100 text-amber-800",
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  denied: "bg-red-100 text-red-800",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_PILL_COLORS[status] ?? "bg-neutral-100 text-neutral-600"}`}
    >
      {status}
    </span>
  );
}

const RISK_TEXT_COLORS: Record<string, string> = {
  low: "text-green-700",
  medium: "text-amber-700",
  high: "text-red-700",
};

export function RiskLabel({ level, score, className = "" }: { level: string | null; score: number | null; className?: string }) {
  if (!level) return null;
  return (
    <span className={`${RISK_TEXT_COLORS[level] ?? ""} ${className}`}>
      {level} ({score})
    </span>
  );
}
