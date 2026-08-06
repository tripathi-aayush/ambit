import Link from "next/link";
import { LayoutDashboard, MessageSquare, Network, ListTree } from "lucide-react";

const TABS = [
  { key: "overview", label: "Overview", icon: LayoutDashboard, href: (id: string) => `/repos/${id}/overview` },
  { key: "chat", label: "Chat", icon: MessageSquare, href: (id: string) => `/repos/${id}` },
  { key: "architecture", label: "Architecture", icon: Network, href: (id: string) => `/repos/${id}/architecture` },
  { key: "tasks", label: "Tasks", icon: ListTree, href: (id: string) => `/repos/${id}/tasks` },
] as const;

export function RepoNav({ repoId, active }: { repoId: string; active: (typeof TABS)[number]["key"] }) {
  return (
    <nav className="mt-3 flex gap-1 text-sm">
      {TABS.map(({ key, label, icon: Icon, href }) => (
        <Link
          key={key}
          href={href(repoId)}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-950 ${
            key === active
              ? "bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
              : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
          }`}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={2} />
          {label}
        </Link>
      ))}
    </nav>
  );
}
