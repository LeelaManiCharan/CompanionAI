"use client";

/**
 * React binding for the Model_Router's Active_Provider state (Provider_Badge, 6.7).
 */
import { useSyncExternalStore } from "react";
import { modelRouter, type ActiveProviderState } from "./modelRouter";

const SERVER_STATE: ActiveProviderState = Object.freeze({
  id: "none",
  fellBack: false,
  geminiAvailable: false,
  ollamaHealthy: false,
  mode: "auto",
  online: true,
  geminiModel: null,
});

const getServerState = (): ActiveProviderState => SERVER_STATE;

export function useProviderState(): ActiveProviderState {
  return useSyncExternalStore(modelRouter.subscribe, modelRouter.getState, getServerState);
}
