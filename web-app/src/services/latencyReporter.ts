/** One browser-measured voice latency (productionalization.md section 7.2). */
export interface LatencySample {
  kind: "TRANSCRIBE" | "POLLY";
  ms: number;
}

/** Collects voice latencies and reports them in batches; the voice modules only call `record`. */
export interface LatencyReporter {
  record(kind: LatencySample["kind"], ms: number): void;
}

/** The in-memory reporter keeps nothing, as the prototype has no metrics. */
export const silentLatencyReporter: LatencyReporter = { record: () => undefined };

export interface LatencyReporterOptions {
  intervalMs?: number;
  setTimer?: (work: () => void, ms: number) => unknown;
  /** Calls `flush` when the page is hidden, so a closing tab still reports. */
  onHidden?: (flush: () => void) => void;
}

const BATCH = 50;

const whenHidden = (flush: () => void): void => {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
};

/**
 * Sends samples every 30 seconds while any are waiting, at most 50 a
 * report, and when the page is hidden. A failed report drops its samples:
 * metrics never retry into a player's bandwidth.
 */
export function createLatencyReporter(
  send: (samples: LatencySample[]) => Promise<unknown>,
  options: LatencyReporterOptions = {},
): LatencyReporter & { flush: () => void } {
  const interval = options.intervalMs ?? 30_000;
  const setTimer = options.setTimer ?? ((work, ms) => setTimeout(work, ms));
  const waiting: LatencySample[] = [];
  let scheduled = false;
  const flush = (): void => {
    scheduled = false;
    while (waiting.length > 0) void send(waiting.splice(0, BATCH)).catch(() => undefined);
  };
  (options.onHidden ?? whenHidden)(flush);
  return {
    flush,
    record: (kind, ms) => {
      waiting.push({ kind, ms: Math.min(60_000, Math.max(0, Math.round(ms))) });
      if (scheduled) return;
      scheduled = true;
      setTimer(flush, interval);
    },
  };
}
