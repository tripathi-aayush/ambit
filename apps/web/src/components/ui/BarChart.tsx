export function BarChart({
  title,
  data,
  order,
  colors,
  labelWidth = "w-24",
}: {
  title?: string;
  data: Record<string, number>;
  order?: string[];
  colors: Record<string, string>;
  labelWidth?: string;
}) {
  const keys = order ? order.filter((k) => k in data) : Object.keys(data);
  const max = Math.max(1, ...Object.values(data));

  if (keys.length === 0) {
    return (
      <div>
        {title && <h2 className="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">{title}</h2>}
        <p className="text-sm text-neutral-500 dark:text-neutral-400">No data yet.</p>
      </div>
    );
  }

  return (
    <div>
      {title && <h2 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-300">{title}</h2>}
      <div className="space-y-2.5">
        {keys.map((key) => (
          <div key={key} className="flex items-center gap-3 text-sm">
            <span className={`${labelWidth} shrink-0 truncate text-neutral-600 dark:text-neutral-400`}>
              {key.replace(/_/g, " ")}
            </span>
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
              <div
                className={`h-full rounded-full transition-all ${colors[key] ?? "bg-neutral-400"}`}
                style={{ width: `${(data[key] / max) * 100}%` }}
              />
            </div>
            <span className="w-8 shrink-0 text-right text-neutral-500 dark:text-neutral-400">{data[key]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
