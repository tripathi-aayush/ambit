import { type HTMLAttributes } from "react";

export function Card({
  hoverable = false,
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement> & { hoverable?: boolean }) {
  return (
    <div
      className={`rounded-md border border-neutral-200 p-4 dark:border-neutral-800 ${hoverable ? "transition-all duration-150 hover:border-neutral-300 hover:shadow-sm dark:hover:border-neutral-700" : ""} ${className}`}
      {...props}
    />
  );
}
