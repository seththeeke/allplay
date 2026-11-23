const TEXTURE_WIDTH = 512;
const TEXTURE_HEIGHT = 256;
const RADIUS = 0.98;
const AXIS_TILT = 0.2;
const VIEW_LEAN = 0.16;
const LIGHT: readonly [number, number, number] = [-0.56, 0.5, 0.66];

type Rgb = readonly [number, number, number];

/* Cloud belts and zones from the north pole (0) to the south pole (1). */
const BANDS: readonly (readonly [number, Rgb])[] = [
  [0, [92, 82, 74]],
  [0.12, [150, 126, 102]],
  [0.22, [222, 201, 168]],
  [0.3, [187, 130, 88]],
  [0.37, [132, 78, 52]],
  [0.44, [232, 215, 186]],
  [0.52, [247, 236, 212]],
  [0.58, [204, 154, 108]],
  [0.65, [146, 88, 56]],
  [0.72, [222, 198, 160]],
  [0.8, [178, 138, 102]],
  [0.9, [134, 114, 96]],
  [1, [84, 76, 70]],
];
const SPOT: Rgb = [184, 70, 42];
const SPOT_COLLAR: Rgb = [238, 220, 190];

const smooth = (t: number): number => t * t * (3 - 2 * t);
const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/* A fixed hash, so the planet looks the same on every visit. */
const hash = (x: number, y: number): number => {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
};

/** Value noise that wraps every `period` cells across longitude, so the texture has no seam. */
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

function turbulence(u: number, v: number, period: number, rows: number): number {
  let total = 0;
  let weight = 0.5;
  let scale = 1;
  for (let octave = 0; octave < 4; octave += 1) {
    total += noise(u * period * scale, v * rows * scale, period * scale) * weight;
    weight /= 2;
    scale *= 2;
  }
  return total / 0.9375;
}

function bandColor(position: number): Rgb {
  const t = clamp01(position);
  for (let index = 1; index < BANDS.length; index += 1) {
    const [end, to] = BANDS[index] as readonly [number, Rgb];
    const [start, from] = BANDS[index - 1] as readonly [number, Rgb];
    if (t <= end) return mix(from, to, smooth((t - start) / (end - start)));
  }
  return (BANDS[BANDS.length - 1] as readonly [number, Rgb])[1];
}

/** The storm's color at a point, swirled so that it reads as a vortex. */
function withSpot(color: Rgb, u: number, v: number): Rgb {
  const wrapped = ((u - 0.3 + 0.5) % 1) - 0.5;
  const dx = wrapped / 0.078;
  const dy = (v - 0.665) / 0.062;
  const distance = Math.hypot(dx, dy);
  if (distance >= 1.45) return color;
  const swirl = 0.5 + 0.5 * Math.sin(Math.atan2(dy, dx) * 2 + distance * 9);
  const collared = mix(color, SPOT_COLLAR, smooth(clamp01((1.45 - distance) / 0.4)) * 0.75);
  const storm = mix(SPOT, [216, 112, 72], swirl * 0.45);
  return mix(collared, storm, smooth(clamp01((1.08 - distance) / 0.3)));
}

/** The banded cloud map as RGB, longitude across and latitude down. */
export function buildJupiterTexture(): Uint8Array {
  const texture = new Uint8Array(TEXTURE_WIDTH * TEXTURE_HEIGHT * 3);
  for (let y = 0; y < TEXTURE_HEIGHT; y += 1) {
    const v = (y + 0.5) / TEXTURE_HEIGHT;
    for (let x = 0; x < TEXTURE_WIDTH; x += 1) {
      const u = x / TEXTURE_WIDTH;
      const warp = (turbulence(u, v, 10, 12) - 0.5) * 0.075;
      const streak = 1 + (turbulence(u + warp, v, 6, 70) - 0.5) * 0.3;
      const color = withSpot(bandColor(v + warp), u + warp * 0.35, v + warp * 0.35);
      const at = (y * TEXTURE_WIDTH + x) * 3;
      texture[at] = Math.min(255, color[0] * streak);
      texture[at + 1] = Math.min(255, color[1] * streak);
      texture[at + 2] = Math.min(255, color[2] * streak);
    }
  }
  return texture;
}

let sharedTexture: Uint8Array | null = null;

export interface JupiterSphere {
  /** Writes the planet at `rotation` radians into RGBA pixels of `size` by `size`. */
  draw(pixels: Uint8ClampedArray, rotation: number): void;
}

/**
 * A lit, tilted sphere (conversational-ai.md section 8). Each pixel's place
 * on the globe and its light are computed once, so a frame is only a texture
 * lookup and stays cheap for an animation that runs through a whole game.
 */
export function createJupiterSphere(size: number): JupiterSphere {
  sharedTexture ??= buildJupiterTexture();
  const texture = sharedTexture;
  const count = size * size;
  const column = new Int16Array(count);
  const row = new Int16Array(count);
  const light = new Float32Array(count);
  const alpha = new Uint8Array(count);
  const cosTilt = Math.cos(AXIS_TILT);
  const sinTilt = Math.sin(AXIS_TILT);
  const cosLean = Math.cos(VIEW_LEAN);
  const sinLean = Math.sin(VIEW_LEAN);
  const edge = 2 / size;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const sx = (((px + 0.5) / size) * 2 - 1) / RADIUS;
      const sy = (1 - ((py + 0.5) / size) * 2) / RADIUS;
      const r = Math.hypot(sx, sy);
      if (r >= 1) continue;
      const index = py * size + px;
      const sz = Math.sqrt(1 - r * r);
      const tiltedX = sx * cosTilt + sy * sinTilt;
      const tiltedY = sy * cosTilt - sx * sinTilt;
      const globeY = tiltedY * cosLean - sz * sinLean;
      const globeZ = tiltedY * sinLean + sz * cosLean;
      const longitude = Math.atan2(tiltedX, globeZ);
      const latitude = Math.asin(clamp01((globeY + 1) / 2) * 2 - 1);
      column[index] = Math.floor((longitude / (2 * Math.PI) + 1) * TEXTURE_WIDTH);
      row[index] = Math.min(
        TEXTURE_HEIGHT - 1,
        Math.floor((0.5 - latitude / Math.PI) * TEXTURE_HEIGHT),
      );
      const diffuse = Math.max(0, sx * LIGHT[0] + sy * LIGHT[1] + sz * LIGHT[2]);
      light[index] = (0.34 + 0.84 * Math.pow(diffuse, 0.85)) * Math.pow(sz, 0.22);
      alpha[index] = Math.round(clamp01((1 - r) / edge) * 255);
    }
  }
  return {
    draw: (pixels, rotation) => {
      const turn = rotation / (2 * Math.PI);
      const offset = Math.floor((turn - Math.floor(turn)) * TEXTURE_WIDTH);
      for (let index = 0; index < count; index += 1) {
        const out = index * 4;
        const opacity = alpha[index] as number;
        pixels[out + 3] = opacity;
        if (opacity === 0) continue;
        const u = ((column[index] as number) + offset) % TEXTURE_WIDTH;
        const at = ((row[index] as number) * TEXTURE_WIDTH + u) * 3;
        const shade = light[index] as number;
        pixels[out] = (texture[at] as number) * shade;
        pixels[out + 1] = (texture[at + 1] as number) * shade;
        pixels[out + 2] = (texture[at + 2] as number) * shade;
      }
    },
  };
}
