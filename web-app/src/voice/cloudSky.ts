const TEXTURE_WIDTH = 512;
const TEXTURE_HEIGHT = 256;
const RADIUS = 0.985;
/* The disc shows half the texture's width, so clouds take a long time to repeat. */
const VIEW_WIDTH = 0.5;
const CLOUD_LINE = 0.37;
const CLOUD_SOFTNESS = 0.13;
const CLOUD_RAGGEDNESS = 0.46;
const BREATH = 0.012;

type Rgb = readonly [number, number, number];

const SKY_TOP: Rgb = [66, 100, 222];
const SKY_LOW: Rgb = [112, 142, 240];
const CLOUD: Rgb = [238, 241, 253];
const HAZE: Rgb = [181, 195, 244];

const smooth = (t: number): number => t * t * (3 - 2 * t);
const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/* A fixed hash, so the sky looks the same on every visit. */
const hash = (x: number, y: number): number => {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
};

/** Value noise that wraps every `period` cells across, so the drifting clouds have no seam. */
function noise(x: number, y: number, period: number): number {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const blendX = smooth(x - cellX);
  const blendY = smooth(y - cellY);
  const at = (i: number, j: number) => hash(((i % period) + period) % period, j);
  const top = at(cellX, cellY) + (at(cellX + 1, cellY) - at(cellX, cellY)) * blendX;
  const bottom = at(cellX, cellY + 1) + (at(cellX + 1, cellY + 1) - at(cellX, cellY + 1)) * blendX;
  return top + (bottom - top) * blendY;
}

function turbulence(u: number, v: number, period: number, rows: number, octaves: number): number {
  let total = 0;
  let weight = 0.5;
  let sum = 0;
  let scale = 1;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += noise(u * period * scale, v * rows * scale, period * scale) * weight;
    sum += weight;
    weight /= 2;
    scale *= 2;
  }
  return total / sum;
}

/** One layer of cloud density, 0 to 255, wrapping across its width. */
export function buildCloudLayer(period: number, rows: number, octaves: number): Uint8Array {
  const layer = new Uint8Array(TEXTURE_WIDTH * TEXTURE_HEIGHT);
  for (let y = 0; y < TEXTURE_HEIGHT; y += 1) {
    const v = (y + 0.5) / TEXTURE_HEIGHT;
    for (let x = 0; x < TEXTURE_WIDTH; x += 1) {
      const u = x / TEXTURE_WIDTH;
      /* Warping the lookup by more noise gives billows rather than a regular grain. */
      const warp = (turbulence(u, v, 4, 3, 2) - 0.5) * 0.16;
      const value = turbulence(u + warp, v + warp, period, rows, octaves);
      layer[y * TEXTURE_WIDTH + x] = Math.round(clamp01((value - 0.2) / 0.6) * 255);
    }
  }
  return layer;
}

let sharedLayers: { broad: Uint8Array; fine: Uint8Array } | null = null;

export interface CloudSky {
  /** Writes the sky at `phase` (one unit is a full drift) into RGBA pixels of `size` by `size`. */
  draw(pixels: Uint8ClampedArray, phase: number): void;
}

/**
 * A round view of a cloudy sky (conversational-ai.md section 8). Two cloud
 * layers slide past each other, so the shapes slowly change. Everything that
 * does not move is computed once, which keeps a frame cheap through a game.
 */
export function createCloudSky(size: number): CloudSky {
  sharedLayers ??= { broad: buildCloudLayer(5, 4, 4), fine: buildCloudLayer(18, 14, 3) };
  const { broad, fine } = sharedLayers;
  const count = size * size;
  const column = new Int16Array(count);
  const row = new Int16Array(count);
  const alpha = new Uint8Array(count);
  const light = new Float32Array(count);
  const height = new Float32Array(count);
  const skyColors = new Float32Array(size * 3);
  const hazeColors = new Float32Array(size * 3);
  for (let py = 0; py < size; py += 1) {
    const v = (py + 0.5) / size;
    const sky = mix(SKY_TOP, SKY_LOW, smooth(clamp01(v / 0.55)));
    const haze = mix(CLOUD, HAZE, smooth(clamp01((v - 0.5) / 0.26)));
    skyColors.set(sky, py * 3);
    hazeColors.set(haze, py * 3);
    for (let px = 0; px < size; px += 1) {
      const sx = (((px + 0.5) / size) * 2 - 1) / RADIUS;
      const sy = (((py + 0.5) / size) * 2 - 1) / RADIUS;
      const r = Math.hypot(sx, sy);
      if (r >= 1) continue;
      const index = py * size + px;
      alpha[index] = Math.round(clamp01((1 - r) / (2 / size)) * 255);
      column[index] = Math.floor(((px + 0.5) / size) * VIEW_WIDTH * TEXTURE_WIDTH);
      row[index] = Math.floor(v * TEXTURE_HEIGHT);
      height[index] = v;
      /* A faint light from above and a soft edge give the disc depth without a planet's shadow. */
      light[index] = 1.02 - 0.05 * sy - 0.07 * Math.pow(r, 4);
    }
  }

  const sample = (layer: Uint8Array, at: number, x: number, blend: number): number => {
    const first = layer[at + (x % TEXTURE_WIDTH)] as number;
    const second = layer[at + ((x + 1) % TEXTURE_WIDTH)] as number;
    return first + (second - first) * blend;
  };

  return {
    draw: (pixels, phase) => {
      const drift = phase - Math.floor(phase);
      const broadAt = drift * TEXTURE_WIDTH;
      const fineAt = (1 - drift) * TEXTURE_WIDTH * 2;
      const broadStart = Math.floor(broadAt);
      const fineStart = Math.floor(fineAt);
      /* Blending between texels keeps very slow movement smooth rather than stepped. */
      const broadBlend = broadAt - broadStart;
      const fineBlend = fineAt - fineStart;
      const line = CLOUD_LINE + BREATH * Math.sin(drift * Math.PI * 2);
      for (let index = 0; index < count; index += 1) {
        const out = index * 4;
        const opacity = alpha[index] as number;
        pixels[out + 3] = opacity;
        if (opacity === 0) continue;
        const y = row[index] as number;
        const x = column[index] as number;
        const rowAt = y * TEXTURE_WIDTH;
        const density =
          (sample(broad, rowAt, x + broadStart, broadBlend) * 0.66 +
            sample(fine, rowAt, x + fineStart, fineBlend) * 0.34) /
          255;
        const edge = (height[index] as number) - line + (density - 0.5) * CLOUD_RAGGEDNESS;
        const cover = smooth(clamp01(edge / CLOUD_SOFTNESS));
        const band = Math.floor(index / size) * 3;
        const shade = light[index] as number;
        for (let channel = 0; channel < 3; channel += 1) {
          const from = skyColors[band + channel] as number;
          const to = hazeColors[band + channel] as number;
          pixels[out + channel] = (from + (to - from) * cover) * shade;
        }
      }
    },
  };
}
