export function Logo({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="24" height="24" rx="6" className="fill-accent" />
      <path d="M7 16.5L12 7L17 16.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 13H14.5" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
