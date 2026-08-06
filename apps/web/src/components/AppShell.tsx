"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, FolderGit2, History } from "lucide-react";
import { type ReactNode } from "react";
import { Logo } from "@/components/Logo";

const GLOBAL_NAV = [
  { href: "/", label: "Repositories", icon: FolderGit2, match: (p: string) => p === "/" || p.startsWith("/repos") },
  { href: "/timeline", label: "Timeline", icon: History, match: (p: string) => p.startsWith("/timeline") },
  { href: "/analytics", label: "Analytics", icon: BarChart3, match: (p: string) => p.startsWith("/analytics") },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-full">
      <nav className="flex w-52 shrink-0 flex-col border-r border-neutral-200 px-3 py-4 dark:border-neutral-800">
        <Link
          href="/"
          className="mb-6 flex items-center gap-2 rounded-md px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-950"
        >
          <Logo className="h-6 w-6" />
          <span className="text-sm font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Ambit</span>
        </Link>

        <div className="space-y-0.5">
          {GLOBAL_NAV.map(({ href, label, icon: Icon, match }) => {
            const active = match(pathname);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-950 ${
                  active
                    ? "bg-accent/10 font-medium text-accent"
                    : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
                }`}
              >
                <Icon className="h-4 w-4" strokeWidth={2} />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>

      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
