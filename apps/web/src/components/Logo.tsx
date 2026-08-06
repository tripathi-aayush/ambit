// A prompt mark ("> _" in a rounded outlined square) -- generic enough
// to read as "dev tool" across the amber palette, just softened corners
// to match the rest of the system instead of the old sharp/square style.
export function Logo({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="1" y="1" width="22" height="22" rx="5" className="stroke-accent" strokeWidth="1.5" />
      <path d="M6 8L11 12L6 16" className="stroke-accent" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="13" y1="16" x2="18" y2="16" className="stroke-accent" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
