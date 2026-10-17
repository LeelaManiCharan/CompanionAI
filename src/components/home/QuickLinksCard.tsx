import Link from "next/link";
import type { ReactNode } from "react";
import { Card, IconActivity, IconChevronLeft, IconMemory, IconSettings, IconUsers } from "@/components/ui";

const LINKS: { href: string; label: string; hint: string; icon: ReactNode }[] = [
  { href: "/memories", label: "Memories", hint: "What your companion remembers", icon: <IconMemory size={16} /> },
  { href: "/activity", label: "Activity", hint: "Your usage on this device", icon: <IconActivity size={16} /> },
  { href: "/settings", label: "Settings", hint: "Name, tone, model, check-ins", icon: <IconSettings size={16} /> },
  { href: "/profiles", label: "Profiles", hint: "Switch or manage profiles", icon: <IconUsers size={16} /> },
];

/** Shortcuts to the secondary pages (3.6). */
export function QuickLinksCard() {
  return (
    <Card as="section" aria-labelledby="shortcuts-heading" className="overflow-hidden">
      <h2
        id="shortcuts-heading"
        className="border-b border-border px-5 py-3 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted"
      >
        Shortcuts
      </h2>
      <ul className="divide-y divide-border">
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-bg-subtle focus-visible:bg-bg-subtle focus-visible:outline-offset-[-2px]"
            >
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-primary"
              >
                {l.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium tracking-[-0.01em] text-text">{l.label}</span>
                <span className="block truncate text-[13px] text-muted">{l.hint}</span>
              </span>
              <IconChevronLeft
                size={16}
                className="shrink-0 rotate-180 text-muted/60 transition-transform group-hover:translate-x-0.5 group-hover:text-text"
              />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
