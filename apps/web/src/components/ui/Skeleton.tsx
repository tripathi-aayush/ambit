export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-foreground-dim/15 ${className}`} />;
}

export function SkeletonRow() {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
      <div className="space-y-2">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-3 w-56" />
      </div>
      <Skeleton className="h-5 w-16" />
    </div>
  );
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3 ${i === lines - 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </div>
  );
}
