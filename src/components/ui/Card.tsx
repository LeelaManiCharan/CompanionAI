import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type CardProps = HTMLAttributes<HTMLElement> & {
  /** Render as a semantic section/article instead of a div. */
  as?: "div" | "section" | "article" | "li";
  /** Subtle tinted background for secondary panels. */
  muted?: boolean;
};

export function Card({ as: Tag = "div", muted, className, ...rest }: CardProps) {
  return (
    <Tag
      className={cn(
        "rounded-lg border border-border shadow-card",
        muted ? "bg-bg-subtle" : "bg-bg",
        className,
      )}
      {...rest}
    />
  );
}

export type CardHeaderProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  /** Right-aligned slot for badges or actions. */
  actions?: ReactNode;
};

export function CardHeader({ actions, className, children, ...rest }: CardHeaderProps) {
  return (
    <div
      className={cn("flex items-start justify-between gap-3 border-b border-border px-5 py-4", className)}
      {...rest}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export type CardTitleProps = HTMLAttributes<HTMLHeadingElement> & {
  as?: "h2" | "h3" | "h4";
};

export function CardTitle({ as: Tag = "h2", className, ...rest }: CardTitleProps) {
  return <Tag className={cn("text-base font-semibold tracking-[-0.02em] text-text", className)} {...rest} />;
}

export function CardDescription({ className, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-0.5 text-sm text-muted", className)} {...rest} />;
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center justify-end gap-2 border-t border-border px-5 py-3", className)}
      {...rest}
    />
  );
}
