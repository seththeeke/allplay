import { useEffect, useRef, type RefObject } from "react";
import type { AppPreferences } from "../models/api";
import { createJupiterSphere } from "../voice/jupiterSphere";
import type { OrbState } from "../voice/useConversation";

/** Canvas pixels per side: sharp at the greeting size on a high-density screen. */
export const ORB_PIXELS = 320;

/* Radians per second for each state: a slow drift at rest, quicker while engaged. */
const SPIN: Record<OrbState, number> = {
  GREETING: 0.5,
  IDLE: 0.3,
  HEARING: 2.4,
  THINKING: 1.6,
  SPEAKING: 0.6,
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

/** Draws the planet on a canvas and turns it; with reduced motion it is one still frame. */
export function useOrbCanvas(
  state: OrbState,
  reducedMotion: AppPreferences["reducedMotion"],
): RefObject<HTMLCanvasElement | null> {
  const canvas = useRef<HTMLCanvasElement>(null);
  const target = useRef(SPIN[state]);
  useEffect(() => {
    target.current = SPIN[state];
  }, [state]);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return undefined;
    const sphere = createJupiterSphere(ORB_PIXELS);
    const image = context.createImageData(ORB_PIXELS, ORB_PIXELS);
    let rotation = 0;
    const paint = (): void => {
      sphere.draw(image.data, rotation);
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
      rotation += speed * seconds;
      paint();
      frame = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [reducedMotion]);
  return canvas;
}
