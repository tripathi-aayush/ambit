"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, GitBranch, ListChecks, RotateCcw } from "lucide-react";
import { getAnalyticsSummary, type AnalyticsSummary } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { SkeletonText } from "@/components/ui/Skeleton";

const RISK_BAR_COLORS: Record<string, string> = {
  low: "bg-risk-low",
  medium: "bg-risk-medium",
  high: "bg-risk-high",
};

const RISK_ORDER = ["low", "medium", "high"];

const STATUS_BAR_COLORS: Record<string, string> = {
  pending: "bg-amber-400",
  approved: "bg-blue-400",
  executing: "bg-amber-400",
  completed: "bg-green-500",
  failed: "bg-red-500",
  denied: "bg-red-400",
};

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail?: string;
  icon: typeof ListChecks;
}) {
  return (
    <Card>
      <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">{value}</p>
      {detail && <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">{detail}</p>}
    </Card>
  );
}

function BarChart({
  title,
  data,
  order,
  colors,
}: {
  title: string;
  data: Record<string, number>;
  order?: string[];
  colors: Record<string, string>;
}) {
  const keys = order ? order.filter((k) => k in data) : Object.keys(data);
  const max = Math.max(1, ...Object.values(data));

  if (keys.length === 0) {
    return (
      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">{title}</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">No data yet.</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-300">{title}</h2>
      <div className="space-y-2.5">
        {keys.map((key) => (
          <div key={key} className="flex items-center gap-3 text-sm">
            <span className="w-24 shrink-0 text-neutral-600 dark:text-neutral-400">{key.replace(/_/g, " ")}</span>
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
              <div
                className={`h-full rounded-full transition-all ${colors[key] ?? "bg-neutral-400"}`}
                style={{ width: `${(data[key] / max) * 100}%` }}
              />
            </div>
            <span className="w-8 shrink-0 text-right text-neutral-500 dark:text-neutral-400">{data[key]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAnalyticsSummary()
      .then(setSummary)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const decisionsTotal = (summary?.approvals_approved ?? 0) + (summary?.approvals_denied ?? 0);
  const acceptanceRate = decisionsTotal > 0 ? Math.round((summary!.approvals_approved / decisionsTotal) * 100) : null;
  const rollbackRate =
    summary && summary.total_plans > 0 ? Math.round((summary.rollback_plans / summary.total_plans) * 100) : null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-8">
      <PageHeader
        title="Analytics"
        description="Aggregated across every repository and adapter — acceptance rate, rollback frequency, and risk distribution over every action Ambit has governed."
      />

      {error && <ErrorMessage>{error}</ErrorMessage>}
      {!summary && !error && <SkeletonText lines={5} />}

      {summary && (
        <div className="space-y-8">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Total actions" value={String(summary.total_actions)} icon={ListChecks} />
            <StatCard label="Total plans" value={String(summary.total_plans)} icon={GitBranch} />
            <StatCard
              label="Acceptance rate"
              value={acceptanceRate === null ? "—" : `${acceptanceRate}%`}
              detail={decisionsTotal > 0 ? `${summary.approvals_approved}/${decisionsTotal} human decisions` : "no human decisions yet"}
              icon={CheckCircle2}
            />
            <StatCard
              label="Rollback frequency"
              value={rollbackRate === null ? "—" : `${rollbackRate}%`}
              detail={`${summary.rollback_plans}/${summary.total_plans} plans were reverts`}
              icon={RotateCcw}
            />
          </div>

          <Card className="grid gap-8 sm:grid-cols-2">
            <BarChart title="Risk distribution" data={summary.by_risk_level} order={RISK_ORDER} colors={RISK_BAR_COLORS} />
            <BarChart title="Action status" data={summary.by_status} colors={STATUS_BAR_COLORS} />
          </Card>
        </div>
      )}
    </div>
  );
}
