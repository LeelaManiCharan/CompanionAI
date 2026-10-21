"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type SettingsNavItem = { id: string; label: string };

export type SettingsSectionProps = {
  id: string;
  /** Two-digit index shown in mono above the title. */
  index: string;
  title: string;
  description?: ReactNode;
  /** Right-aligned slot in the header (badges). */
  meta?: ReactNode;
  tone?: "default" | "danger";
  children: ReactNode;
};

/** One anchored settings section: mono index, title, description, and a bordered body. */
export function SettingsSection({ id, index, title, description, meta, tone = "default", children }: SettingsSectionProps) {
  const titleId = `${id}-title`;
  return (
    <section id={id} aria-labelledby={titleId} className="scroll-mt-24">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p
            className={cn(
              "font-mono text-[11px] font-semibold uppercase tracking-[0.08em]",
              tone === "danger" ? "text-danger" : "text-gradient-brand",
            )}
          >
            {index}
          </p>
          <h2 id={titleId} className="mt-1 text-lg leading-7 tracking-[-0.02em] text-text">
            {title}
          </h2>
          {description ? <p className="mt-0.5 max-w-2xl text-sm text-muted">{description}</p> : null}
        </div>
        {meta ? <div className="shrink-0 pb-0.5">{meta}</div> : null}
      </div>
      <div
        className={cn(
          "rounded-lg border bg-bg shadow-card transition-shadow duration-300 hover:shadow-elevated",
          tone === "danger" ? "border-danger/30" : "border-border",
        )}
      >
        {children}
      </div>
    </section>
  );
}

/** A padded row inside a section body; rows are separated by hairlines. */
export function SettingsRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("border-b border-border px-5 py-5 last:border-b-0 sm:px-6", className)}>{children}</div>;
}

/**
 * In-page navigation. Sticky in a left rail on desktop; a horizontal strip on
 * small screens. Highlights the section currently in view.
 */
export function SettingsNav({ items }: { items: SettingsNavItem[] }) {
  const [active, setActive] = useState(items[0]?.id ?? "");

  useEffect(() => {
    const els = items.map((i) => document.getElementById(i.id)).filter((el): el is HTMLElement => el !== null);
    if (els.length === 0 || typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.set(e.target.id, e.boundingClientRect.top);
          else visible.delete(e.target.id);
        }
        // The first section (in page order) that is in the reading band wins.
        const first = items.find((i) => visible.has(i.id));
        if (first) setActive(first.id);
      },
      { rootMargin: "-88px 0px -55% 0px", threshold: 0 },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [items]);

  const link = (item: SettingsNavItem, compact: boolean) => {
    const isActive = item.id === active;
    return (
      <a
        href={`#${item.id}`}
        aria-current={isActive ? "location" : undefined}
        onClick={() => setActive(item.id)}
        className={cn(
          "block whitespace-nowrap rounded-md text-sm transition-all duration-200",
          compact ? "px-3 py-1.5" : "px-3 py-2",
          isActive
            ? "bg-gradient-brand font-medium text-white shadow-glow"
            : "text-muted hover:bg-surface hover:text-text",
        )}
      >
        {item.label}
      </a>
    );
  };

  return (
    <>
      <nav aria-label="Settings sections" className="-mx-4 mb-8 overflow-x-auto px-4 lg:hidden">
        <ul className="flex gap-1">
          {items.map((i) => (
            <li key={i.id}>{link(i, true)}</li>
          ))}
        </ul>
      </nav>
      <nav aria-label="Settings sections" className="sticky top-24 hidden self-start lg:block">
        <ul className="flex flex-col gap-0.5 border-l border-border pl-3">
          {items.map((i) => (
            <li key={i.id}>{link(i, false)}</li>
          ))}
        </ul>
      </nav>
    </>
  );
}
