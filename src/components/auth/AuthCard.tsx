import { useId, type ReactNode } from "react";
import { Card } from "@/components/ui";

export type AuthCardProps = {
  /** Small mono label above the title. */
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  /** Muted strip under the card body (e.g. "New here? Create an account"). */
  footer?: ReactNode;
  children: ReactNode;
};

/** The centered card used by /login, /signup and /reset-password. */
export function AuthCard({ eyebrow, title, description, footer, children }: AuthCardProps) {
  const titleId = useId();
  return (
    <Card as="section" aria-labelledby={titleId} className="overflow-hidden shadow-elevated">
      <div className="px-6 pb-7 pt-7 sm:px-8">
        {eyebrow ? (
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-gradient-brand">{eyebrow}</p>
        ) : null}
        <h1 id={titleId} className="mt-1 text-[22px] leading-7 tracking-[-0.03em] text-text">
          {title}
        </h1>
        {description ? <p className="mt-1.5 text-sm leading-5 text-muted">{description}</p> : null}
        <div className="mt-6">{children}</div>
      </div>
      {footer ? (
        <div className="border-t border-border bg-bg-subtle px-6 py-4 text-center text-sm text-muted sm:px-8">
          {footer}
        </div>
      ) : null}
    </Card>
  );
}

/** Inline text link styled for auth copy. */
export const authLinkClass =
  "rounded-sm font-medium text-primary underline-offset-4 transition-colors hover:text-primary-hover hover:underline";
