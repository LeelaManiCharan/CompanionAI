"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  dismissPrompt,
  getSchedulerState,
  getServerSchedulerState,
  snooze as snoozeCheckIn,
  subscribeScheduler,
  type CheckInPrompt,
  type ServiceResult,
} from "./scheduler";
import type { CheckIn } from "@/core/models";

export interface UseCheckInPrompt {
  /** The in-app Daily_Check_In prompt to show, or null. */
  prompt: CheckInPrompt | null;
  /** Hides the prompt; the check-in stays triggered for today. */
  dismiss: () => void;
  /** Snoozes the prompt's check-in for 30 minutes (once per date). */
  snooze: () => Promise<ServiceResult<CheckIn>>;
}

/** Subscribes to the Check_In_Scheduler's in-app prompt (12.6, 12.10, 13.5). */
export function useCheckInPrompt(): UseCheckInPrompt {
  const { prompt } = useSyncExternalStore(subscribeScheduler, getSchedulerState, getServerSchedulerState);
  const profileId = prompt?.profileId ?? null;
  const snooze = useCallback(() => snoozeCheckIn(profileId), [profileId]);
  return { prompt, dismiss: dismissPrompt, snooze };
}
