import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { type ReactNode } from "react";

export function PageHeader({
  title,
  description,
  backHref,
  backLabel = "All repositories",
  tabs,
  actions,
}: {
  title: ReactNode;
  description?: string;
  backHref?: string;
  backLabel?: string;
  tabs?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 border-b border-neutral-200 pb-4 dark:border-neutral-800">
      {backHref && (
        <Link
          href={backHref}
          className="mb-1 inline-flex items-center gap-1 rounded text-xs text-neutral-500 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 dark:text-neutral-400 dark:hover:text-neutral-100 dark:focus-visible:ring-offset-neutral-950"
        >
          <ChevronLeft className="h-3 w-3" /> {backLabel}
        </Link>
      )}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">{title}</h1>
          {description && <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {tabs}
    </header>
  );
}
