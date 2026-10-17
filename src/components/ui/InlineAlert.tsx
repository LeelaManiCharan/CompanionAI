import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { IconAlert, IconCheckCircle, IconInfo, IconX } from "./icons";

export type AlertTone = "info" | "success" | "warning" | "danger";

const tones: Record<AlertTone, { box: string; icon: string; Glyph: typeof IconInfo }> = {
  info: { box: "border-border bg-bg-subtle", icon: "text-primary", Glyph: IconInfo },
  success: { box: "border-primary/25 bg-accent", icon: "text-primary", Glyph: IconCheckCircle },
  // No amber in this palette: warnings read as a stronger neutral.
  warning: { box: "border-text/25 bg-surface", icon: "text-text", Glyph: IconAlert },
  danger: { box: "border-danger/30 bg-danger/[0.05]", icon: "text-danger", Glyph: IconAlert },
};

export type InlineAlertProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  tone?: AlertTone;
  title?: ReactNode;
  /** Buttons/links rendered under the message. */
  actions?: ReactNode;
  /** Renders a dismiss button when provided. */
  onDismiss?: () => void;
  /** Override live-region role. Defaults: status (info/success), alert (warning/danger). */
  role?: "status" | "alert" | "note";
};

export function InlineAlert({
  tone = "info",
  title,
  actions,
  onDismiss,
  role,
  className,
  children,
  ...rest
}: InlineAlertProps) {
  const t = tones[tone];
  const resolvedRole = role ?? (tone === "warning" || tone === "danger" ? "alert" : "status");
  return (
    <div
      role={resolvedRole}
      className={cn("flex items-start gap-3 rounded-md border px-3.5 py-3 text-sm text-text", t.box, className)}
      {...rest}
    >
      <t.Glyph size={18} className={cn("mt-px shrink-0", t.icon)} />
      <div className="min-w-0 flex-1">
        {title ? <p className={cn("font-semibold leading-5", tone === "danger" && "text-danger")}>{title}</p> : null}
        {children ? <div className={cn("leading-5 text-text/85", title ? "mt-0.5" : null)}>{children}</div> : null}
        {actions ? <div className="mt-2.5 flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-m-1 inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          <IconX size={14} />
        </button>
      ) : null}
    </div>
  );
}
