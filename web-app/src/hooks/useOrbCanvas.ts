import { useEffect, useRef, type RefObject } from "react";
import type { AppPreferences } from "../models/api";
import { createCloudSky } from "../voice/cloudSky";
import type { OrbState } from "../voice/useConversation";

/** Canvas pixels per side: sharp at the greeting size on a high-density screen. */
export const ORB_PIXELS = 320;

/* Drifts per second for each state: barely moving at rest, a little livelier while engaged. */
const DRIFT: Record<OrbState, number> = {
  GREETING: 0.008,
  IDLE: 0.005,
  HEARING: 0.03,
  THINKING: 0.018,
  SPEAKING: 0.01,
  PAUSED: 0,
};
const EASING_PER_SECOND = 4;
const MAX_FRAME_SECONDS = 0.1;

function prefersStill(setting: AppPreferences["reducedMotion"]): boolean {
  if (setting !== "SYSTEM") return setting === "ON";
  return (
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Draws the cloudy sky on a canvas and drifts it; with reduced motion it is one still frame. */
export function useOrbCanvas(
  state: OrbState,
  reducedMotion: AppPreferences["reducedMotion"],
): RefObject<HTMLCanvasElement | null> {
  const canvas = useRef<HTMLCanvasElement>(null);
  const target = useRef(DRIFT[state]);
  useEffect(() => {
    target.current = DRIFT[state];
  }, [state]);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return undefined;
    const sky = createCloudSky(ORB_PIXELS);
    const image = context.createImageData(ORB_PIXELS, ORB_PIXELS);
    let phase = 0;
    const paint = (): void => {
      sky.draw(image.data, phase);
      context.putImageData(image, 0, 0);
    };
    paint();
    if (prefersStill(reducedMotion)) return undefined;
    let speed = target.current;
    let last: number | null = null;
    let frame = requestAnimationFrame(function tick(now) {
      const seconds = last === null ? 0 : Math.min(MAX_FRAME_SECONDS, (now - last) / 1000);
      last = now;
      speed += (target.current - speed) * Math.min(1, seconds * EASING_PER_SECOND);
      phase += speed * seconds;
      paint();
      frame = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [reducedMotion]);
  return canvas;
}
