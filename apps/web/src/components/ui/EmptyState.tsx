import { type LucideIcon } from "lucide-react";
import { type ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <Icon className="h-6 w-6 text-foreground-dim" strokeWidth={1.5} />
      <div>
        <p className="font-display text-sm font-extrabold text-foreground">{title}</p>
        {description && <p className="mt-1 text-sm text-foreground-dim">{description}</p>}
      </div>
      {action}
    </div>
  );
}
