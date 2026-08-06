"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, FolderGit2, History, Home, ShieldAlert } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Logo } from "@/components/Logo";
import { listAllActions } from "@/lib/api";
import { onPendingChanged } from "@/lib/pendingSignal";

const GLOBAL_NAV = [
  { href: "/", label: "Home", icon: Home, match: (p: string) => p === "/" },
  { href: "/approvals", label: "Approvals", icon: ShieldAlert, match: (p: string) => p.startsWith("/approvals") },
  { href: "/repos", label: "Repositories", icon: FolderGit2, match: (p: string) => p.startsWith("/repos") },
  { href: "/timeline", label: "Audit Log", icon: History, match: (p: string) => p.startsWith("/timeline") },
  { href: "/analytics", label: "Analytics", icon: BarChart3, match: (p: string) => p.startsWith("/analytics") },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [pendingCount, setPendingCount] = useState(0);
  const [executingCount, setExecutingCount] = useState(0);
  const [deniedCount, setDeniedCount] = useState(0);

  useEffect(() => {
    const refresh = () => {
      listAllActions()
        .then((actions) => {
          setPendingCount(actions.filter((a) => a.status === "pending").length);
          setExecutingCount(actions.filter((a) => a.status === "executing").length);
          setDeniedCount(actions.filter((a) => a.status === "denied").length);
        })
        .catch(() => {});
    };
    refresh();
    return onPendingChanged(refresh);
  }, [pathname]);

  return (
    <div className="flex min-h-full">
      <nav className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-border px-3 py-4">
        <Link
          href="/"
          className="mb-6 flex items-center gap-2 rounded-lg px-2 py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          <Logo className="h-6 w-6" />
          <span className="font-display text-sm font-extrabold tracking-tight text-foreground">Orion</span>
        </Link>

        <div className="space-y-0.5">
          {GLOBAL_NAV.map(({ href, label, icon: Icon, match }) => {
            const active = match(pathname);
            const showBadge = href === "/approvals" && pendingCount > 0;
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                  active ? "bg-accent/10 text-accent" : "text-foreground-dim hover:bg-surface hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
                {label}
                {showBadge && (
                  <span className="ml-auto flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-risk-high px-1 font-mono text-[10px] font-semibold text-white">
                    {pendingCount}
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        <div className="mt-auto space-y-2 rounded-lg border border-border bg-surface px-3 py-3 text-xs">
          <p className="font-mono uppercase tracking-wide text-foreground-dim">Status</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className={`font-display text-lg font-extrabold ${pendingCount > 0 ? "text-risk-medium" : "text-foreground"}`}>{pendingCount}</p>
              <p className="text-[10px] uppercase tracking-wide text-foreground-dim">Pending</p>
            </div>
            <div>
              <p className={`font-display text-lg font-extrabold ${executingCount > 0 ? "text-risk-medium" : "text-foreground"}`}>{executingCount}</p>
              <p className="text-[10px] uppercase tracking-wide text-foreground-dim">Running</p>
            </div>
            <div>
              <p className={`font-display text-lg font-extrabold ${deniedCount > 0 ? "text-risk-high" : "text-foreground"}`}>{deniedCount}</p>
              <p className="text-[10px] uppercase tracking-wide text-foreground-dim">Denied</p>
            </div>
          </div>
        </div>
      </nav>

      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
