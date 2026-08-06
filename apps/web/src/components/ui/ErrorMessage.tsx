import { CircleAlert } from "lucide-react";

export function ErrorMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-risk-high/30 bg-risk-high-bg px-3 py-2 text-sm text-risk-high">
      <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}
