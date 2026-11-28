import { describe, expect, it, vi } from "vitest";
import { createPauseSignal } from "../../src/services/pauseSignal";

describe("pause signal", () => {
  it("notifies listeners only when the state changes, until they unsubscribe", () => {
    const signal = createPauseSignal();
    const listener = vi.fn();
    const stop = signal.subscribe(listener);
    signal.set(false);
    expect(listener).not.toHaveBeenCalled();
    signal.set(true);
    signal.set(true);
    expect(signal.paused()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    signal.set(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(signal.paused()).toBe(false);
  });
});
