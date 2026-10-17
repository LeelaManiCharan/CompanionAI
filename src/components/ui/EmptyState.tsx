import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type EmptyStateProps = {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Primary/secondary actions. */
  actions?: ReactNode;
  /** Heading level for the title. */
  as?: "h2" | "h3" | "h4";
  className?: string;
};

export function EmptyState({ icon, title, description, actions, as: Heading = "h3", className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-lg border border-dashed border-border bg-bg-subtle px-6 py-10 text-center",
        className,
      )}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className="mb-4 flex size-10 items-center justify-center rounded-md border border-border bg-bg text-primary shadow-card"
        >
          {icon}
        </div>
      ) : null}
      <Heading className="text-[15px] font-semibold tracking-[-0.02em] text-text">{title}</Heading>
      {description ? <p className="mt-1 max-w-sm text-sm text-muted">{description}</p> : null}
      {actions ? <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
    </div>
  );
}
