"use client";

/**
 * Per-user local runtime teardown (Req 22.4, 22.10).
 *
 * Used on sign-out (this tab or another), and before a different user's
 * Local_Store is opened in this tab. Order matters: the active call is ended
 * first so its transcript is written to the signed-out user's database, then
 * background services stop, and only then is the database closed.
 */
import { resetRepo } from "@/data/repository";
import { stopActivityTracker } from "./activityTracker";
import { setPreferencesSyncUser } from "./preferencesSync";
import { stopScheduler } from "./scheduler";
import { resetSession } from "./session";
import { stopTabCoordinator } from "./tabCoordinator";
import { endActiveCall } from "./voice/useCallController";

let running: Promise<void> | null = null;

/** Ends any call (awaiting the transcript save), stops services, and closes the Local_Store. Idempotent. */
export function teardownLocalData(): Promise<void> {
  if (running) return running;
  running = (async () => {
    try {
      await endActiveCall();
    } catch {
      // A failed final write must not block sign-out.
    }
    setPreferencesSyncUser(null);
    stopScheduler();
    stopActivityTracker();
    stopTabCoordinator();
    resetRepo();
    resetSession();
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Resolves once no teardown is in progress. */
export function localTeardownSettled(): Promise<void> {
  return running ?? Promise.resolve();
}
