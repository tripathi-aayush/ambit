import { type HTMLAttributes, type ReactNode } from "react";

type Tone = "default" | "accent" | "warning" | "danger";

const TONE_BORDER: Record<Tone, string> = {
  default: "border-border",
  accent: "border-accent/30",
  warning: "border-risk-medium/30",
  danger: "border-risk-high/30",
};

const TONE_BG: Record<Tone, string> = {
  default: "bg-surface",
  accent: "bg-accent/[0.08]",
  warning: "bg-risk-medium-bg",
  danger: "bg-risk-high-bg",
};

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hoverable?: boolean;
  padded?: boolean;
  tone?: Tone;
  /** Renders a standalone dash-prefixed micro-label above the panel
      ("— LABEL"), matching the reference's section-label convention. */
  label?: ReactNode;
}

export function Card({ hoverable = false, padded = true, tone = "default", label, className = "", children, ...props }: CardProps) {
  return (
    <div>
      {label && (
        <div className="mb-2 flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider text-accent">
          <span aria-hidden="true">—</span>
          <span>{label}</span>
        </div>
      )}
      <div
        className={`rounded-lg border ${TONE_BORDER[tone]} ${TONE_BG[tone]} ${padded ? "p-4" : ""} ${hoverable ? "transition-colors duration-150 hover:border-foreground-dim" : ""} ${className}`}
        {...props}
      >
        {children}
      </div>
    </div>
  );
}
