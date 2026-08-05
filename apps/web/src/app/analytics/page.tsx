"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getAnalyticsSummary, type AnalyticsSummary } from "@/lib/api";

const RISK_BAR_COLORS: Record<string, string> = {
  low: "bg-green-500",
  medium: "bg-amber-500",
  high: "bg-red-500",
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

function StatCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-md border border-neutral-200 p-4">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {detail && <p className="mt-1 text-xs text-neutral-400">{detail}</p>}
    </div>
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
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">{title}</h2>
        <p className="text-sm text-neutral-500">No data yet.</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-neutral-700">{title}</h2>
      <div className="space-y-2">
        {keys.map((key) => (
          <div key={key} className="flex items-center gap-3 text-sm">
            <span className="w-24 shrink-0 text-neutral-600">{key}</span>
            <div className="h-4 flex-1 overflow-hidden rounded bg-neutral-100">
              <div
                className={`h-full ${colors[key] ?? "bg-neutral-400"}`}
                style={{ width: `${(data[key] / max) * 100}%` }}
              />
            </div>
            <span className="w-8 shrink-0 text-right text-neutral-500">{data[key]}</span>
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
      <header className="mb-6 border-b border-neutral-200 pb-4">
        <Link href="/" className="text-xs text-neutral-500 hover:underline">
          ← All repositories
        </Link>
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Analytics</h1>
          <Link href="/timeline" className="text-sm text-neutral-500 hover:underline">
            Timeline →
          </Link>
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          Aggregated across every repository and adapter — acceptance rate, rollback frequency, and risk
          distribution over every action Ambit has governed.
        </p>
      </header>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!summary && !error && <p className="text-sm text-neutral-400">Loading…</p>}

      {summary && (
        <div className="space-y-8">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Total actions" value={String(summary.total_actions)} />
            <StatCard label="Total plans" value={String(summary.total_plans)} />
            <StatCard
              label="Acceptance rate"
              value={acceptanceRate === null ? "—" : `${acceptanceRate}%`}
              detail={decisionsTotal > 0 ? `${summary.approvals_approved}/${decisionsTotal} human decisions` : "no human decisions yet"}
            />
            <StatCard
              label="Rollback frequency"
              value={rollbackRate === null ? "—" : `${rollbackRate}%`}
              detail={`${summary.rollback_plans}/${summary.total_plans} plans were reverts`}
            />
          </div>

          <BarChart title="Risk distribution" data={summary.by_risk_level} order={RISK_ORDER} colors={RISK_BAR_COLORS} />
          <BarChart title="Action status" data={summary.by_status} colors={STATUS_BAR_COLORS} />
        </div>
      )}
    </div>
  );
}
