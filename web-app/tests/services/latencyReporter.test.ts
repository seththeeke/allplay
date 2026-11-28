import { describe, expect, it, vi } from "vitest";
import {
  createLatencyReporter,
  silentLatencyReporter,
  type LatencySample,
} from "../../src/services/latencyReporter";

describe("latency reporter", () => {
  it("batches samples on one timer, at most 50 a report, and flushes when the page hides", () => {
    const sent: LatencySample[][] = [];
    const timers: (() => void)[] = [];
    let hidden: () => void = () => undefined;
    const reporter = createLatencyReporter(
      (samples) => {
        sent.push(samples);
        return Promise.resolve();
      },
      {
        setTimer: (work) => timers.push(work),
        onHidden: (flush) => {
          hidden = flush;
        },
      },
    );
    for (let index = 0; index < 60; index += 1) reporter.record("POLLY", 100 + index);
    expect(timers).toHaveLength(1);
    timers[0]?.();
    expect(sent.map((batch) => batch.length)).toEqual([50, 10]);
    reporter.record("TRANSCRIBE", -5);
    reporter.record("TRANSCRIBE", 90_000.4);
    hidden();
    expect(sent[2]).toEqual([
      { kind: "TRANSCRIBE", ms: 0 },
      { kind: "TRANSCRIBE", ms: 60_000 },
    ]);
    expect(timers).toHaveLength(2);
  });

  it("drops a failed report, and the in-memory reporter keeps nothing", async () => {
    const send = vi.fn(() => Promise.reject(new Error("offline")));
    const reporter = createLatencyReporter(send, { onHidden: () => undefined, intervalMs: 1 });
    reporter.record("POLLY", 10);
    reporter.flush();
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    expect(() => {
      silentLatencyReporter.record("POLLY", 1);
    }).not.toThrow();
  });

  it("flushes on a hidden page through the document by default", () => {
    const send = vi.fn(() => Promise.resolve());
    const reporter = createLatencyReporter(send, { setTimer: () => undefined });
    reporter.record("POLLY", 5);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(send).toHaveBeenCalledWith([{ kind: "POLLY", ms: 5 }]);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(send).toHaveBeenCalledTimes(1);
  });
});
