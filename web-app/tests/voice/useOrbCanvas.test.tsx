import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ORB_PIXELS, useOrbCanvas } from "../../src/hooks/useOrbCanvas";
import type { AppPreferences } from "../../src/models/api";
import type { OrbState } from "../../src/voice/useConversation";

function Orb({ state, motion }: { state: OrbState; motion: AppPreferences["reducedMotion"] }) {
  const canvas = useOrbCanvas(state, motion);
  return <canvas ref={canvas} width={ORB_PIXELS} height={ORB_PIXELS} />;
}

function fakeCanvas() {
  const painted: number[] = [];
  const putImageData = vi.fn((image: { data: Uint8ClampedArray }) => {
    painted.push(image.data.reduce((sum, value) => sum + value, 0));
  });
  const context = {
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData,
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as RenderingContext,
  );
  const frames: FrameRequestCallback[] = [];
  const cancel = vi.fn();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", cancel);
  const step = (now: number) => {
    frames.shift()?.(now);
  };
  return { putImageData, painted, frames, cancel, step };
}

describe("orb canvas", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("drifts frame by frame and stops when removed", () => {
    const t = fakeCanvas();
    const view = render(<Orb state="HEARING" motion="OFF" />);
    expect(t.putImageData).toHaveBeenCalledTimes(1);
    t.step(0);
    t.step(100);
    t.step(5000);
    expect(t.putImageData).toHaveBeenCalledTimes(4);
    expect(new Set(t.painted.slice(1)).size).toBeGreaterThan(1);
    view.unmount();
    expect(t.cancel).toHaveBeenCalled();
  });

  it("eases to a stop when paused", () => {
    const t = fakeCanvas();
    const view = render(<Orb state="IDLE" motion="OFF" />);
    view.rerender(<Orb state="PAUSED" motion="OFF" />);
    t.step(0);
    for (let now = 100; now <= 6000; now += 100) t.step(now);
    const settled = t.painted.at(-1);
    t.step(6100);
    expect(t.painted.at(-1)).toBe(settled);
  });

  it("paints one still frame when motion is reduced by the setting or the system", () => {
    const t = fakeCanvas();
    render(<Orb state="HEARING" motion="ON" />);
    expect(t.putImageData).toHaveBeenCalledTimes(1);
    expect(t.frames).toHaveLength(0);
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    render(<Orb state="HEARING" motion="SYSTEM" />);
    expect(t.frames).toHaveLength(0);
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    render(<Orb state="HEARING" motion="SYSTEM" />);
    expect(t.frames).toHaveLength(1);
    vi.stubGlobal("matchMedia", undefined);
    render(<Orb state="HEARING" motion="SYSTEM" />);
    expect(t.frames).toHaveLength(2);
  });

  it("leaves the CSS gradient in place when canvas is unavailable", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const raf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);
    render(<Orb state="IDLE" motion="OFF" />);
    expect(raf).not.toHaveBeenCalled();
  });
});
