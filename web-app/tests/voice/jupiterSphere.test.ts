import { describe, expect, it } from "vitest";
import { buildJupiterTexture, createJupiterSphere } from "../../src/voice/jupiterSphere";

const SIZE = 64;
const pixel = (data: Uint8ClampedArray, x: number, y: number) =>
  [...data.slice((y * SIZE + x) * 4, (y * SIZE + x) * 4 + 4)] as [number, number, number, number];
const brightness = ([r, g, b]: number[]) => (r ?? 0) + (g ?? 0) + (b ?? 0);
const render = (rotation: number) => {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  createJupiterSphere(SIZE).draw(data, rotation);
  return data;
};

describe("Jupiter sphere", () => {
  it("draws a round disc and leaves the corners clear", () => {
    const data = render(0);
    expect(pixel(data, 0, 0)[3]).toBe(0);
    expect(pixel(data, SIZE - 1, SIZE - 1)[3]).toBe(0);
    expect(pixel(data, SIZE / 2, SIZE / 2)[3]).toBe(255);
  });

  it("lights the upper left and leaves the lower right in shadow", () => {
    const data = render(0);
    expect(brightness(pixel(data, 20, 20))).toBeGreaterThan(brightness(pixel(data, 46, 46)) * 1.3);
  });

  it("turns with rotation and returns after a full turn, in either direction", () => {
    const start = render(0);
    expect(render(1.5)).not.toEqual(start);
    expect(render(Math.PI * 2)).toEqual(start);
    expect(render(-Math.PI * 2)).toEqual(start);
  });

  it("has warm cloud bands and a red storm, with no seam across longitude", () => {
    const texture = buildJupiterTexture();
    const at = (x: number, y: number) => [
      ...texture.slice((y * 512 + x) * 3, (y * 512 + x) * 3 + 3),
    ];
    const row = (y: number) => {
      let red = 0;
      for (let x = 0; x < 512; x += 1) red += at(x, y)[0] ?? 0;
      return red / 512;
    };
    expect(Math.abs(row(133) - row(95))).toBeGreaterThan(30);
    const [r = 0, g = 0, b = 0] = at(154, 170);
    expect(r).toBeGreaterThan(g * 1.4);
    expect(r).toBeGreaterThan(b * 1.6);
    for (const y of [40, 100, 200]) {
      const step = Math.abs((at(0, y)[0] ?? 0) - (at(511, y)[0] ?? 0));
      expect(step).toBeLessThan(40);
    }
  });
});
