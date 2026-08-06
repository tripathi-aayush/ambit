// Moved here alongside events.ts for the same reason -- this was
// duplicated verbatim between apps/web/src/lib/time.ts and
// apps/cli/src/format.ts (ported from it), and never touched React or
// Node either.
export function timeAgo(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) {
    const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
    if (hours <= 0) return "just now";
    return `${hours}h ago`;
  }
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
