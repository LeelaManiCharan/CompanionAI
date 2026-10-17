"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";
import { IconAlert, IconCheckCircle, IconInfo, IconX } from "./icons";

export type ToastTone = "neutral" | "success" | "danger";

export type ToastOptions = {
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** ms before auto-dismiss. 0 keeps it until dismissed. Default 5000. */
  duration?: number;
};

type ToastItem = Required<Pick<ToastOptions, "tone" | "duration">> & ToastOptions & { id: number };

type ToastContextValue = {
  toast: (opts: ToastOptions | string) => number;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_VISIBLE = 4;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((opts: ToastOptions | string) => {
    const o = typeof opts === "string" ? { title: opts } : opts;
    const id = nextId.current++;
    setItems((list) =>
      [...list, { tone: "neutral" as const, duration: 5000, ...o, id }].slice(-MAX_VISIBLE),
    );
    return id;
  }, []);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Region is always mounted so screen readers pick up new toasts. */}
      <div
        aria-live="polite"
        aria-relevant="additions text"
        aria-label="Notifications"
        role="region"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6"
      >
        {items.map((t) => (
          <ToastCard key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const toneStyles: Record<ToastTone, { icon: string; Glyph: typeof IconInfo }> = {
  neutral: { icon: "text-muted", Glyph: IconInfo },
  success: { icon: "text-primary", Glyph: IconCheckCircle },
  danger: { icon: "text-danger", Glyph: IconAlert },
};

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(item.duration);
  const startedAt = useRef(0);

  useEffect(() => {
    if (item.duration <= 0 || paused) return;
    startedAt.current = Date.now();
    const timer = window.setTimeout(onDismiss, remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
    };
  }, [item.duration, paused, onDismiss]);

  const { icon, Glyph } = toneStyles[item.tone];

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(
        "pointer-events-auto flex w-full max-w-sm animate-toast-in items-start gap-3 rounded-md border bg-bg px-3.5 py-3",
        "shadow-[0_4px_16px_rgb(17_24_20/0.08)]",
        item.tone === "danger" ? "border-danger/30" : "border-border",
      )}
    >
      <Glyph size={18} className={cn("mt-px shrink-0", icon)} />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium leading-5 text-text">{item.title}</p>
        {item.description ? <p className="mt-0.5 leading-5 text-muted">{item.description}</p> : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="-m-1 inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:bg-surface hover:text-text"
      >
        <IconX size={14} />
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
