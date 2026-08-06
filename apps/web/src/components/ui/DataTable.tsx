import { type HTMLAttributes, type TdHTMLAttributes, type ThHTMLAttributes } from "react";

// Real <table> markup, rounded container, translucent row borders --
// used where the data is genuinely tabular (the Repository Overview
// panel), not another card grid.
export function DataTable({ children, className = "", ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className={`w-full border-collapse text-left text-sm ${className}`} {...props}>
        {children}
      </table>
    </div>
  );
}

export function DataTh({ children, className = "", ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={`border-b border-border px-3 py-2 font-mono text-xs font-normal uppercase tracking-wide text-foreground-dim ${className}`}
      {...props}
    >
      {children}
    </th>
  );
}

export function DataTd({ children, className = "", ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={`border-b border-border/60 px-3 py-2 ${className}`} {...props}>
      {children}
    </td>
  );
}
