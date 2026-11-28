import { useSyncExternalStore } from "react";
import { pauseSignal, type PauseSignal } from "../services/pauseSignal";

/** True while the server says play is paused by the andon cord (productionalization.md section 4.3). */
export function usePaused(signal: PauseSignal = pauseSignal): boolean {
  return useSyncExternalStore(signal.subscribe, signal.paused);
}
