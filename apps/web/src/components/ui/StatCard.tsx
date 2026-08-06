import { type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/Card";

export function StatCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail?: string;
  icon: LucideIcon;
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
