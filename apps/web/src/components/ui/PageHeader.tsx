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
    <header className="mb-6 border-b border-border pb-4">
      {backHref && (
        <Link
          href={backHref}
          className="mb-1 inline-flex items-center gap-1 text-xs text-foreground-dim hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          <ChevronLeft className="h-3 w-3" /> {backLabel}
        </Link>
      )}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-extrabold tracking-tight text-foreground">{title}</h1>
          {description && <p className="mt-1 text-sm text-foreground-dim">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {tabs}
    </header>
  );
}
