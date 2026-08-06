import { diffLines } from "diff";
import { type Action } from "@/lib/api";

// Two distinct cases, not one: a completed/executed action has both
// previous_content (captured by the executor right before overwriting) and
// content, so a real diff is possible. A still-pending action only has the
// proposed content -- previous_content doesn't exist yet because nothing
// has read the live file. Showing the proposed content plainly (no false
// diff coloring implying we know what it's replacing) is still the point:
// reviewers should see what they're approving before it happens, not after.
export function DiffView({ action }: { action: Action }) {
  const previous = action.action_metadata.previous_content;
  const current = action.action_type === "file_write" ? action.action_metadata.content : "";

  if (typeof previous === "string") {
    const parts = diffLines(previous, (current as string) ?? "");
    return (
      <pre className="max-h-80 overflow-auto rounded-lg border border-border bg-surface p-3 text-xs leading-relaxed">
        {parts.map((part, i) => (
          <span
            key={i}
            className={
              part.added
                ? "block bg-risk-low-bg text-risk-low"
                : part.removed
                  ? "block bg-risk-high-bg text-risk-high"
                  : "block text-foreground-dim"
            }
          >
            {part.value
              .split("\n")
              .filter((_, idx, arr) => idx < arr.length - 1)
              .map((line, li) => (
                <span key={li} className="block">
                  {part.added ? "+ " : part.removed ? "- " : "  "}
                  {line}
                </span>
              ))}
          </span>
        ))}
      </pre>
    );
  }

  if (action.action_type === "file_write" && typeof current === "string") {
    return (
      <div>
        <p className="mb-1 text-xs text-foreground-dim">Proposed content — not yet compared against the live file:</p>
        <pre className="max-h-80 overflow-auto rounded-lg border border-border bg-surface p-3 text-xs leading-relaxed text-foreground">
          {current}
        </pre>
      </div>
    );
  }

  if (action.action_type === "file_delete") {
    return (
      <p className="text-xs text-foreground-dim">
        This file will be deleted: <span className="font-mono">{action.target}</span>
      </p>
    );
  }

  return <p className="text-xs text-foreground-dim">No diffable content available for this action.</p>;
}
