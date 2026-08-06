import { type Components } from "react-markdown";

// Shared prose styling for any LLM-generated markdown rendered in the app
// (repo chat answers, architecture READMEs) — one definition so the two
// don't drift. max-w-[65ch] on text elements only (not code, which needs
// its full width to avoid excessive wrapping) keeps prose at a readable
// line length instead of stretching to the page's full container width.
export const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mb-2 mt-4 text-lg font-semibold tracking-tight text-neutral-900 first:mt-0 dark:text-neutral-100">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-4 text-base font-semibold tracking-tight text-neutral-900 first:mt-0 dark:text-neutral-100">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1 mt-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="mb-3 max-w-[65ch] text-sm leading-relaxed text-neutral-700 last:mb-0 dark:text-neutral-300">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="mb-3 max-w-[65ch] list-disc space-y-1 pl-5 text-sm text-neutral-700 dark:text-neutral-300">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 max-w-[65ch] list-decimal space-y-1 pl-5 text-sm text-neutral-700 dark:text-neutral-300">{children}</ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-neutral-900 dark:text-neutral-100">{children}</strong>,
  code: ({ children }) => (
    <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs dark:bg-neutral-800">{children}</code>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="rounded text-accent underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {children}
    </a>
  ),
  hr: () => null,
};
