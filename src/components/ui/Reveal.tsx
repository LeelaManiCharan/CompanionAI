"use client";

import { useEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type RevealProps = Omit<HTMLAttributes<HTMLElement>, "children"> & {
  children: ReactNode;
  /** ms delay before the fade/slide starts once visible. */
  delay?: number;
  /** Render as `li` when wrapping a list item, so list semantics stay intact. */
  as?: "div" | "li";
};

/**
 * Scroll-triggered entrance. Children sit invisible until this element
 * crosses into the viewport, then fade and slide up once (not on every
 * scroll past, so re-scrolling doesn't replay it). Renders already-visible
 * when IntersectionObserver isn't available, so content never gets stuck
 * hidden; `prefers-reduced-motion` disables the animation itself via the
 * global motion-reduction rule, not this component.
 */
export function Reveal({ children, delay = 0, as: Tag = "div", className, style, ...rest }: RevealProps) {
  const nodeRef = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  // Callback ref: a plain function (rather than a RefObject) is what lets a
  // single ref work across the "div" | "li" union of intrinsic element types.
  const setRef = (el: HTMLElement | null) => {
    nodeRef.current = el;
  };

  useEffect(() => {
    const el = nodeRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const mergedStyle: CSSProperties | undefined = visible && delay ? { ...style, animationDelay: `${delay}ms` } : style;

  return (
    <Tag ref={setRef} className={cn(visible ? "animate-fade-up" : "opacity-0", className)} style={mergedStyle} {...rest}>
      {children}
    </Tag>
  );
}
