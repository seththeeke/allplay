/** Shared geometry for the small admin charts: one y-axis, a fixed viewBox, recessive ticks. */

export const CHART = { width: 640, height: 240, left: 56, right: 16, top: 12, bottom: 32 } as const;

export const plotWidth = CHART.width - CHART.left - CHART.right;
export const plotHeight = CHART.height - CHART.top - CHART.bottom;

/** A "nice" upper bound that divides into four whole-number ticks. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 4, 6, 8].find((candidate) => candidate * magnitude >= value) ?? 10;
  return step * magnitude;
}

export function yAt(value: number, max: number): number {
  return CHART.top + plotHeight - (value / max) * plotHeight;
}

export function ticks(max: number, count = 4): number[] {
  return Array.from({ length: count + 1 }, (_, index) => (max / count) * index);
}

/** Every nth label, so dates never collide on a 30 day axis. */
export function labelEvery(count: number): number {
  return Math.max(1, Math.ceil(count / 6));
}

export function shortDate(period: string): string {
  const [, month = "", day = ""] = period.split("-");
  return `${String(Number(month))}/${String(Number(day))}`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}
