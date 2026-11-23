import { describe, expect, it } from "vitest";
import { buildCloudLayer, createCloudSky } from "../../src/voice/cloudSky";

const SIZE = 64;
const pixel = (data: Uint8ClampedArray, x: number, y: number) =>
  [...data.slice((y * SIZE + x) * 4, (y * SIZE + x) * 4 + 4)] as [number, number, number, number];
const render = (phase: number) => {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  createCloudSky(SIZE).draw(data, phase);
  return data;
};

describe("cloud sky", () => {
  it("draws a round disc and leaves the corners clear", () => {
    const data = render(0);
    expect(pixel(data, 0, 0)[3]).toBe(0);
    expect(pixel(data, SIZE - 1, SIZE - 1)[3]).toBe(0);
    expect(pixel(data, SIZE / 2, SIZE / 2)[3]).toBe(255);
  });

  it("runs from deep blue through white cloud to pale haze", () => {
    const data = render(0);
    const [topRed, , topBlue] = pixel(data, SIZE / 2, 3);
    const [cloudRed] = pixel(data, SIZE / 2, Math.round(SIZE * 0.52));
    const [lowRed, , lowBlue] = pixel(data, SIZE / 2, SIZE - 4);
    expect(topBlue).toBeGreaterThan(topRed * 2);
    expect(cloudRed).toBeGreaterThan(205);
    expect(lowRed).toBeGreaterThan(topRed * 2);
    expect(lowRed).toBeLessThan(cloudRed);
    expect(lowBlue).toBeGreaterThan(lowRed);
  });

  it("gives the cloud line a ragged edge rather than a straight one", () => {
    const data = render(0);
    const cloudTop = (x: number) => {
      for (let y = 4; y < SIZE; y += 1) if (pixel(data, x, y)[0] > 170) return y;
      return SIZE;
    };
    const tops = Array.from({ length: 40 }, (_, i) => cloudTop(12 + i));
    expect(Math.max(...tops) - Math.min(...tops)).toBeGreaterThan(2);
  });

  it("moves only a little per step, and returns after a full drift", () => {
    const start = render(0);
    const next = render(0.001);
    expect(next).not.toEqual(start);
    let largest = 0;
    for (let index = 0; index < start.length; index += 1)
      largest = Math.max(largest, Math.abs((start[index] ?? 0) - (next[index] ?? 0)));
    expect(largest).toBeLessThan(40);
    expect(render(1)).toEqual(start);
    expect(render(-1)).toEqual(start);
  });

  it("builds cloud layers that wrap with no visible seam", () => {
    const layer = buildCloudLayer(5, 4, 2);
    for (const y of [20, 120, 220]) {
      const first = layer[y * 512] ?? 0;
      const last = layer[y * 512 + 511] ?? 0;
      expect(Math.abs(first - last)).toBeLessThan(30);
    }
  });
});
