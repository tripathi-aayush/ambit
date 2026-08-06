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
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-neutral-200 px-6 py-12 text-center dark:border-neutral-800">
      <Icon className="h-6 w-6 text-neutral-300 dark:text-neutral-600" strokeWidth={1.5} />
      <div>
        <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{title}</p>
        {description && <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{description}</p>}
      </div>
      {action}
    </div>
  );
}
