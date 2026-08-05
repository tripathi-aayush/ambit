import Link from "next/link";

const TABS = [
  { key: "chat", label: "Chat", href: (id: string) => `/repos/${id}` },
  { key: "architecture", label: "Architecture", href: (id: string) => `/repos/${id}/architecture` },
  { key: "tasks", label: "Tasks", href: (id: string) => `/repos/${id}/tasks` },
] as const;

export function RepoNav({ repoId, active }: { repoId: string; active: (typeof TABS)[number]["key"] }) {
  return (
    <nav className="mt-2 flex gap-4 text-sm">
      {TABS.map((tab) =>
        tab.key === active ? (
          <span key={tab.key} className="font-medium text-neutral-900">
            {tab.label}
          </span>
        ) : (
          <Link key={tab.key} href={tab.href(repoId)} className="text-neutral-500 hover:underline">
            {tab.label}
          </Link>
        )
      )}
      <Link href="/timeline" className="text-neutral-500 hover:underline">
        Timeline
      </Link>
    </nav>
  );
}
