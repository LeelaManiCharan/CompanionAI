"use client";

import { useSyncExternalStore } from "react";
import {
  callInProgressElsewhere,
  isLeader,
  subscribeCallElsewhere,
  subscribeLeader,
} from "./tabCoordinator";

const serverFalse = () => false;

/** Whether this tab is the leader (shows notifications, runs the scheduler). */
export function useIsLeader(): boolean {
  return useSyncExternalStore(subscribeLeader, isLeader, serverFalse);
}

/** Whether another tab has an active call (call controls should be disabled). */
export function useCallElsewhere(): boolean {
  return useSyncExternalStore(subscribeCallElsewhere, callInProgressElsewhere, serverFalse);
}
