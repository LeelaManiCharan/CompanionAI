"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { onCrisis } from "@/services/chatService";
import { CrisisPanel } from "./CrisisPanel";

export interface SafetyApi {
  /** Shows the Crisis_Resources (help control, crisis detection). */
  showCrisis: () => void;
  hideCrisis: () => void;
  crisisOpen: boolean;
}

const SafetyContext = createContext<SafetyApi | null>(null);

/**
 * Page-level owner of the Crisis_Resources (14.2, 14.5, 14.9, 20.30). Mounted
 * above every page, so deleting a chat, a failed reply, or navigating does not
 * unmount the panel. Each crisis signal re-shows it, even after a dismissal.
 */
export function SafetyProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [showCount, setShowCount] = useState(0);

  const showCrisis = useCallback(() => {
    setOpen(true);
    setShowCount((n) => n + 1);
  }, []);
  const hideCrisis = useCallback(() => setOpen(false), []);

  useEffect(() => onCrisis(() => showCrisis()), [showCrisis]);

  const value = useMemo(() => ({ showCrisis, hideCrisis, crisisOpen: open }), [showCrisis, hideCrisis, open]);

  return (
    <SafetyContext.Provider value={value}>
      {children}
      <CrisisPanel open={open} onDismiss={hideCrisis} showCount={showCount} />
    </SafetyContext.Provider>
  );
}

export function useSafety(): SafetyApi {
  const ctx = useContext(SafetyContext);
  if (!ctx) throw new Error("useSafety must be used inside <SafetyProvider>");
  return ctx;
}
