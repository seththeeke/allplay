/**
 * Whether the server last answered that play is paused by the andon cord
 * (productionalization.md section 4.3). The API client sets it from every
 * response, so it clears itself on the first success after a release.
 */
export interface PauseSignal {
  paused: () => boolean;
  set: (paused: boolean) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createPauseSignal(): PauseSignal {
  let current = false;
  const listeners = new Set<() => void>();
  return {
    paused: () => current,
    set: (paused) => {
      if (paused === current) return;
      current = paused;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The app's one signal, shared by every API client. */
export const pauseSignal = createPauseSignal();
